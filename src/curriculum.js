/* Curriculum map. Lesson ids are fixed here so every author can cross-link. */
registerCurriculum({
  meta:{
    title:'AI Systems Engineering Masterclass',
    subtitle:'From DevOps to AI Platform Engineering, MLOps, LLMOps, AIOps, GPU Infrastructure and Hyperscale AI Architecture',
    edition:'October 2026 edition · facts checked against official docs on 2026-10-14',
    paths:[
      {title:'AI Platform Engineer',blurb:'the core path: model → GPU → inference → Kubernetes → platform',lessons:['v1-neural-networks','v1-transformer','v1-gpu-architecture','v1-gpu-memory','v1-inference-anatomy','v1-kv-cache','v1-batching','v1-engines','v1-k8s-gpu-stack','v1-k8s-serving','v2-platform-architecture','v2-ai-gateway','v2-hyperscale-serving','v3-ch-inference']},
      {title:'GPU Infrastructure Engineer',blurb:'hardware, memory, interconnect, scheduling, fleet economics',lessons:['v1-gpu-architecture','v1-cuda','v1-gpu-memory','v1-multi-gpu-profiling','v2-parallelism','v2-distributed-training','v2-distributed-inference','v1-k8s-gpu-stack','v2-finops-unit-economics','v3-ch-gpu']},
      {title:'MLOps / LLMOps Engineer',blurb:'data → training → registry → release → evaluation → drift',lessons:['v1-data-pipelines','v1-training-loop','v1-finetuning','v2-mlops-foundations','v2-model-cicd','v2-evaluation-monitoring','v2-rag-fundamentals','v2-rag-production','v3-ch-mlops']},
      {title:'MCP & Agent Platform',blurb:'tool calling → MCP → secure remote servers → agents → A2A',lessons:['v1-ai-apps-tools','v2-mcp-why','v2-mcp-protocol','v2-mcp-python','v2-mcp-typescript','v2-mcp-local-remote','v2-mcp-auth','v2-mcp-deploy','v2-mcp-security','v2-mcp-capstone','v2-agents','v2-a2a-multiagent','v3-ch-mcp']},
      {title:'AIOps & Reliability Architect',blurb:'observability, incidents, safe automation, SLOs',lessons:['v2-ai-observability','v2-aiops','v2-hyperscale-serving','v2-multi-region','v3-ch-aiops','v3-prove-incident']},
      {title:'AI FinOps Leader',blurb:'unit economics, capacity, build vs buy, chargeback',lessons:['v2-capacity-planning','v2-finops-unit-economics','v2-finops-optimization','v2-cache-ops','v3-ch-finops','v3-prove-10m']},
      {title:'Interview sprint (2 weeks)',blurb:'the shortest route to interview readiness',lessons:['v3-how-to-interview','v3-ch-foundations','v3-ch-inference','v3-ch-caching','v3-ch-mcp','v3-ch-hyperscale','v3-whiteboard','v3-mock-interviews','v3-prove-llm','v3-prove-10m','v3-prove-incident']}
    ]
  },
  volumes:[
    {num:1,title:'Build and Understand AI',short:'Vol 1 — Build & Understand AI',blurb:'From neural-network fundamentals and model training to GPU execution, inference engines and Kubernetes deployment.',parts:[
      {num:1,title:'AI and machine learning foundations'},
      {num:2,title:'Understanding LLMs'},
      {num:3,title:'Building and training models'},
      {num:4,title:'GPU fundamentals'},
      {num:5,title:'Inference engineering'},
      {num:6,title:'Deploying AI on Kubernetes'}
    ]},
    {num:2,title:'Architect, Scale and Operate AI',short:'Vol 2 — Architect, Scale & Operate',blurb:'Platform architecture, the caching masterclass, distributed systems, MLOps, RAG, MCP and agents, hyperscale, AIOps, FinOps and security.',parts:[
      {num:1,title:'Advanced AI architecture'},
      {num:2,title:'Caching masterclass'},
      {num:3,title:'Distributed training and inference'},
      {num:4,title:'MLOps and LLMOps'},
      {num:5,title:'RAG and AI applications'},
      {num:6,title:'MCP, agents and agent infrastructure'},
      {num:7,title:'Hyperscale AI architecture'},
      {num:8,title:'Observability, AIOps and reliability'},
      {num:9,title:'AI FinOps'},
      {num:10,title:'Security and governance'},
      {num:11,title:'Capstone: the enterprise AI platform'}
    ]},
    {num:3,title:'Master AI Engineering Interviews',short:'Vol 3 — Interview Mastery',blurb:'Senior question bank with full answers, quantitative whiteboarding, debugging drills, mock rounds with scoring, and five final proof-of-skill demonstrations.',parts:[
      {num:1,title:'Interview strategy'},
      {num:2,title:'Question bank by topic'},
      {num:3,title:'Practice: whiteboard, debugging, mocks'},
      {num:4,title:'Final readiness: prove it'}
    ]}
  ]
});
