"""A complete training loop on a toy classification task.  python tiny_mlp.py"""
import torch
from torch import nn

torch.manual_seed(0)
x = torch.randn(512, 4)
y = (x[:, 0] + 2 * x[:, 1] > 0).long()                 # the rule the network must learn
x_tr, y_tr, x_va, y_va = x[:400], y[:400], x[400:], y[400:]

# [START loop]
model = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 2))
opt = torch.optim.AdamW(model.parameters(), lr=1e-2)
for step in range(201):
    model.train()
    opt.zero_grad(set_to_none=True)                     # 1. clear old gradients
    logits = model(x_tr)                                # 2. forward
    loss = nn.functional.cross_entropy(logits, y_tr)    # 3. loss
    loss.backward()                                     # 4. backward (gradients)
    opt.step()                                          # 5. update weights
    if step % 50 == 0:
        model.eval()
        with torch.no_grad():                           # evaluation: no graph, no gradients
            acc = (model(x_va).argmax(1) == y_va).float().mean().item()
        print(f"step {step:3d}  train loss {loss.item():.4f}  val acc {acc:.3f}")
torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "step": step}, "/tmp/tiny_mlp.pt")
# [END loop]
