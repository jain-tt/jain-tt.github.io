// First CUDA kernel: c[i] = a[i] + b[i].  Build: nvcc -O2 vector_add.cu -o vector_add && ./vector_add
// Not compiled in the course test run (no NVIDIA GPU / nvcc on the authoring machine).
#include <cstdio>
#include <cuda_runtime.h>

// [START kernel]
__global__ void vector_add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // global index of this thread
    if (i < n) {                                     // bounds check: the last block may have spare threads
        c[i] = a[i] + b[i];
    }
}
// [END kernel]

int main() {
    const int n = 1000;
    size_t bytes = n * sizeof(float);
    float *a, *b, *c;
    cudaMallocManaged(&a, bytes); cudaMallocManaged(&b, bytes); cudaMallocManaged(&c, bytes);
    for (int i = 0; i < n; i++) { a[i] = i; b[i] = 2 * i; }

    // [START launch]
    int threads = 256;                               // threads per block (a multiple of the 32-thread warp)
    int blocks = (n + threads - 1) / threads;        // ceil(1000 / 256) = 4 blocks = 1,024 threads, 24 idle
    cudaEvent_t start, stop; cudaEventCreate(&start); cudaEventCreate(&stop);
    cudaEventRecord(start);
    vector_add<<<blocks, threads>>>(a, b, c, n);     // launch is ASYNCHRONOUS: returns before the GPU finishes
    cudaEventRecord(stop);
    cudaEventSynchronize(stop);                      // wait for the GPU, otherwise the timing is meaningless
    float ms = 0; cudaEventElapsedTime(&ms, start, stop);
    cudaError_t err = cudaGetLastError();
    // [END launch]
    printf("c[999]=%.0f (expect 2997) kernel=%.3f ms err=%s\n", c[999], ms, cudaGetErrorString(err));
    cudaFree(a); cudaFree(b); cudaFree(c);
    return 0;
}
