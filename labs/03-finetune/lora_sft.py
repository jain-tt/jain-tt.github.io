"""Capstone stage 3: LoRA (or QLoRA) supervised fine-tuning with Transformers + PEFT + TRL.
Tested on CPU with a tiny model (versions: transformers 5.19, peft 0.21.2, trl 1.15, Oct 2026).

CPU smoke test : python lora_sft.py --model hf-internal-testing/tiny-random-LlamaForCausalLM --steps 5 --trainer hf
(TRL 1.15's SFTTrainer needs Triton for its fused loss kernel, which ships with PyTorch on Linux only, so on
 macOS use --trainer hf; on a Linux GPU box the default --trainer trl works.)
Real run (GPU) : python lora_sft.py --model Qwen/Qwen3-1.7B --steps 300 --bf16
QLoRA (GPU)    : python lora_sft.py --model Qwen/Qwen3-8B --qlora --bf16      (needs bitsandbytes + CUDA)
"""
import argparse

import torch
from datasets import load_dataset
from peft import LoraConfig, PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer

a = argparse.ArgumentParser()
a.add_argument("--model", required=True)
a.add_argument("--data", default="data")
a.add_argument("--steps", type=int, default=300)
a.add_argument("--bf16", action="store_true")
a.add_argument("--qlora", action="store_true")
a.add_argument("--out", default="out/atlas-lora")
a.add_argument("--trainer", choices=["trl", "hf"], default="trl",
               help="trl = TRL SFTTrainer (Linux/GPU). hf = plain Transformers Trainer + PEFT (runs anywhere, incl. macOS)")
x = a.parse_args()

tok = AutoTokenizer.from_pretrained(x.model)
if tok.chat_template is None:            # tiny test models ship without one; real instruct models have their own
    tok.chat_template = ("{% for m in messages %}<|{{ m['role'] }}|>{{ m['content'] }}\n{% endfor %}"
                         "{% if add_generation_prompt %}<|assistant|>{% endif %}")
if tok.pad_token is None:
    tok.pad_token = tok.eos_token

# [START qlora]
quant = None
if x.qlora:                              # QLoRA: frozen base stored in 4-bit NF4, compute in bf16, adapters in bf16
    from transformers import BitsAndBytesConfig
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                               bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
model = AutoModelForCausalLM.from_pretrained(x.model, quantization_config=quant,
                                             dtype=torch.bfloat16 if x.bf16 else torch.float32)
# [END qlora]

# [START lora]
lora = LoraConfig(
    r=16,                      # rank: adapter capacity; trainable params per matrix = r × (d_in + d_out)
    lora_alpha=32,             # scaling: the update is multiplied by alpha / r
    lora_dropout=0.05,
    target_modules="all-linear",   # attention q/k/v/o and MLP projections
    task_type="CAUSAL_LM",
)
# [END lora]

# [START config]
cfg = SFTConfig(
    output_dir=x.out,
    max_steps=x.steps,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,        # effective batch = 4 × 4 × number of GPUs
    learning_rate=2e-4,                   # LoRA tolerates a higher LR than full fine-tuning
    lr_scheduler_type="cosine",
    warmup_steps=10,
    max_length=512,
    completion_only_loss=True,            # loss only on the assistant completion, not on the user prompt
    logging_steps=1,
    save_steps=max(1, x.steps),
    eval_strategy="steps", eval_steps=max(1, x.steps),
    bf16=x.bf16,
    use_cpu=not torch.cuda.is_available(),
    report_to=[],                         # set to ["mlflow"] to track experiments
    seed=42,
)
# [END config]

# [START train]
ds = load_dataset("json", data_files={"train": f"{x.data}/train.jsonl", "validation": f"{x.data}/val.jsonl"})
if x.trainer == "trl":
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds["train"], eval_dataset=ds["validation"],
                         processing_class=tok, peft_config=lora)
else:
    # What SFTTrainer does for you, written out: render the chat template, then mask the prompt tokens
    # with -100 so the loss is computed only on the assistant's completion.
    from peft import get_peft_model
    from transformers import DataCollatorForSeq2Seq, Trainer, TrainingArguments

    def encode(ex):
        prompt = tok.apply_chat_template(ex["prompt"], tokenize=False, add_generation_prompt=True)
        full = tok.apply_chat_template(ex["prompt"] + ex["completion"], tokenize=False)
        p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
        ids = tok(full, add_special_tokens=False)["input_ids"][:512] + [tok.eos_token_id]
        labels = [-100] * min(len(p_ids), len(ids)) + ids[len(p_ids):]
        return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels[:len(ids)]}

    tds = ds.map(encode, remove_columns=ds["train"].column_names)
    model = get_peft_model(model, lora)
    args = TrainingArguments(output_dir=x.out, max_steps=x.steps, per_device_train_batch_size=4,
                             gradient_accumulation_steps=4, learning_rate=2e-4, lr_scheduler_type="cosine",
                             warmup_steps=10, logging_steps=1, eval_strategy="steps", eval_steps=max(1, x.steps),
                             save_steps=max(1, x.steps), bf16=x.bf16, use_cpu=not torch.cuda.is_available(),
                             report_to=[], seed=42)
    trainer = Trainer(model=model, args=args, train_dataset=tds["train"], eval_dataset=tds["validation"],
                      data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100))
trainer.model.print_trainable_parameters()       # typically well under 1 % of the base model
trainer.train()
print("eval:", trainer.evaluate())
trainer.save_model(x.out)                        # saves ONLY the adapter (MBs, not GBs)
tok.save_pretrained(x.out)
# [END train]

# [START merge]
# Optional: merge the adapter into the base weights for engines/deployments that want a single checkpoint.
# Keep the unmerged adapter too: multi-LoRA serving (vLLM --enable-lora) loads adapters on top of one base.
if not x.qlora:
    base = AutoModelForCausalLM.from_pretrained(x.model, dtype=torch.float32)
    merged = PeftModel.from_pretrained(base, x.out).merge_and_unload()
    merged.save_pretrained(x.out + "-merged", safe_serialization=True)   # safetensors, not pickle
# [END merge]
