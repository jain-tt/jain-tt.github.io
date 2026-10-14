"""Tensors, shapes, dtypes, devices and autograd in 30 lines.  python tensors_autograd.py"""
import torch

# [START shapes]
device = "cuda" if torch.cuda.is_available() else "cpu"
x = torch.tensor([[1., 2., 3.], [4., 5., 6.]], device=device)   # shape [2, 3]: 2 examples × 3 features
torch.manual_seed(0)
w = torch.randn(3, 2, device=device, requires_grad=True)        # shape [3, 2]: maps 3 features → 2 outputs
y = x @ w                                                        # [2, 3] @ [3, 2] → [2, 2]
print("x", tuple(x.shape), x.dtype, x.device, "| y", tuple(y.shape))
print("bytes of x:", x.numel() * x.element_size(), "(6 floats × 4 B)")
print("bf16 copy uses", x.to(torch.bfloat16).element_size(), "B per element")
# [END shapes]

# [START autograd]
loss = (y ** 2).mean()          # a scalar to minimise
loss.backward()                 # chain rule through the recorded graph → fills w.grad
print("loss", round(loss.item(), 4), "| grad shape", tuple(w.grad.shape))   # same shape as w
with torch.no_grad():
    w -= 0.01 * w.grad          # one gradient-descent step; try 0.1 and watch the loss EXPLODE (step too big)
    w.grad.zero_()              # gradients ACCUMULATE unless cleared
print("new loss", round(((x @ w) ** 2).mean().item(), 4))
# [END autograd]
