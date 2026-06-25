Knowledge_Service

Phase 0 — Architecture & Foundation Specification

Version 0.1

⸻

Executive Summary

Phase 0 is the most important phase of the entire project.

No provider integrations.
No crawling.
No vector database.
No embeddings.

Instead, Phase 0 establishes the architectural principles that every future phase will follow.

A well-designed architecture allows the system to evolve for years without requiring large-scale rewrites.

The primary deliverable of Phase 0 is clarity.

At the completion of this phase another engineer should understand:

* what Knowledge_Service is
* what it is not
* where every responsibility belongs
* how future capabilities plug in
* how external tools are isolated
* how applications interact with the platform
* how future growth occurs without breaking clients

⸻

Vision

Knowledge_Service is not a crawler.

It is not a search engine.

It is not an LLM.

Knowledge_Service is an intelligent knowledge acquisition, processing, storage, and retrieval platform.

Its purpose is to transform unstructured information into trustworthy, reusable knowledge.

Applications should never care whether information came from:

* Crawl4AI
* APIs
* RSS
* GitHub
* PDFs
* Search
* Databases
* Cached content

Applications request knowledge.

Knowledge_Service determines how to obtain it.

⸻

Guiding Principles

These principles are immutable.

Every design decision should support them.

Principle 1

Applications never communicate directly with providers.

Instead

Hermes
↓
Knowledge_Service
↓
Providers

⸻

Principle 2

Providers are replaceable.

Replacing Crawl4AI should not require changing Hermes.

Replacing SearXNG should not require changing BuilderBoard.

Replacing a vector database should require changing only one adapter.

⸻

Principle 3

Knowledge is standardized.

Regardless of acquisition method every document becomes:

Document
Metadata
Source
Timestamp
Markdown
Structured Content
Citations
Relationships

⸻

Principle 4

Evidence is first-class.

Every conclusion must preserve:

* evidence
* confidence
* provenance
* timestamps
* acquisition method

Knowledge_Service never returns unsupported conclusions.

⸻

Principle 5

Every acquisition is reproducible.

Future researchers should be capable of reconstructing how information was acquired.

⸻

Principle 6

Knowledge accumulates.

Every acquisition improves the system.

Nothing is discarded without policy.

⸻

High-Level Responsibilities

Knowledge_Service owns:

* acquisition
* normalization
* metadata
* source registry
* chunking
* storage
* retrieval
* evidence
* citations
* cache
* planning

Knowledge_Service does NOT own:

* agent orchestration
* user interfaces
* scheduling workflows
* application logic
* content publishing

Those belong elsewhere.

⸻

Relationship to Other Projects

Hermes

Hermes decides

“What work should happen?”

Knowledge_Service answers

“What do we know?”

⸻

BuilderBoard

BuilderBoard requests documentation.

Knowledge_Service retrieves documentation.

⸻

Arete

Arete consumes knowledge.

Knowledge_Service produces knowledge.

⸻

SearchAgent

Eventually becomes largely absorbed.

SearchAgent research pipeline becomes part of Knowledge_Service.

⸻

Architectural Layers

The architecture intentionally separates concerns.

Applications
↓
API Layer
↓
Planning Layer
↓
Acquisition Layer
↓
Processing Layer
↓
Knowledge Layer
↓
Provider Layer

Each layer owns one responsibility.

⸻

API Layer

Purpose

Public interface.

Nothing outside Knowledge_Service accesses internal components.

Responsibilities

* authentication
* request validation
* routing
* versioning
* response formatting

Future endpoints

POST /search
POST /crawl
POST /research
POST /retrieve
POST /extract
POST /embed
POST /summarize
POST /knowledge
GET /health

⸻

Planning Layer

This is the future intelligence layer.

Responsibilities

Determine:

* what information is needed
* acquisition order
* provider selection
* freshness requirements
* stopping conditions

Example

Question

“Research latest Next.js changes.”

Planner decides

Official documentation

↓

Release notes

↓

GitHub

↓

Developer blog

↓

Community discussion

instead of blindly crawling.

⸻

Acquisition Layer

Purpose

Acquire information.

Never interpret.

Possible providers

Search

Crawler

GitHub

RSS

PubMed

ClinicalTrials

YouTube

Documentation

PDF

Future APIs

Acquisition only.

No reasoning.

⸻

Processing Layer

Purpose

Normalize all content.

Pipeline

Acquire

↓

Clean

↓

Markdown

↓

Metadata

↓

Extract

↓

Chunk

↓

Relationships

↓

Store

Every downstream component receives identical objects.

⸻

Knowledge Layer

Purpose

Persistent memory.

Contains

documents

embeddings

knowledge graph

cache

metadata

citations

relationships

source registry

Everything beyond this point works on structured knowledge.

⸻

Provider Layer

This layer is intentionally “dumb.”

Examples

Crawl4AI

SearXNG

GitHub API

LM Studio

Qdrant

Redis

Postgres

Providers expose capabilities.

They never contain business logic.

⸻

Provider Abstraction

Every provider follows an interface.

Provider
initialize()
health()
execute()
shutdown()

Knowledge_Service never calls provider-specific code directly.

⸻

Canonical Knowledge Object

Every acquisition becomes one object.

Conceptually

Knowledge Object
ID
Source
URL
Acquired Timestamp
Published Timestamp
Author
Provider
Markdown
Structured Fields
Metadata
Language
Relationships
Citations
Confidence
Hash

Every subsystem consumes identical objects.

⸻

Source Registry

Every source becomes an entity.

Track

trust

freshness

latency

historical usefulness

preferred acquisition

cache policy

failure rate

topics

ownership

The registry grows continuously.

⸻

Knowledge Lifecycle

Every piece of knowledge follows:

Acquire
↓
Normalize
↓
Validate
↓
Store
↓
Index
↓
Retrieve
↓
Update
↓
Archive

Nothing bypasses this lifecycle.

⸻

Core Interfaces

Every subsystem communicates through interfaces.

Never concrete implementations.

Examples

Searcher

Crawler

Extractor

Embedder

Storage

Planner

Research

Every future provider plugs into an interface.

⸻

Error Philosophy

Errors are expected.

Knowledge_Service never crashes because one provider fails.

Instead

Provider Failure
↓
Fallback
↓
Partial Results
↓
Confidence Reduction
↓
Continue

Graceful degradation.

⸻

Observability

Everything is measurable.

Track

request time

provider time

cache hits

cache misses

provider failures

documents acquired

duplicates removed

tokens processed

cost

latency

source quality

Every acquisition is observable.

⸻

Security Philosophy

Never expose provider credentials.

Applications authenticate only to Knowledge_Service.

Knowledge_Service authenticates to providers.

Credential isolation.

⸻

Configuration Philosophy

Configuration should never require code changes.

Policies belong in configuration.

Examples

cache durations

provider priorities

timeouts

retry policy

source trust

rate limits

planner defaults

⸻

Data Ownership

Knowledge_Service owns:

knowledge

Applications own:

business data

Never mix the two.

⸻

Versioning Strategy

Public API versioned.

Internal providers free to evolve.

Applications should survive provider replacement.

⸻

Success Criteria

Phase 0 succeeds when the following questions all have clear answers.

Can another engineer explain the architecture?

Can Crawl4AI be replaced without changing Hermes?

Can SearXNG be replaced without changing BuilderBoard?

Can new providers be added without rewriting the API?

Can new applications consume Knowledge_Service without knowing internal details?

Can knowledge objects flow through every future subsystem unchanged?

Can every future capability be added without violating architectural boundaries?

If any answer is “no,” Phase 0 is incomplete.

⸻

Deliverables

At the completion of Phase 0 the repository should contain:

ARCHITECTURE.md
VISION.md
PRINCIPLES.md
SYSTEM_DIAGRAM.md
API_SPEC.md
PROVIDER_INTERFACE.md
KNOWLEDGE_OBJECT.md
SOURCE_REGISTRY_SPEC.md
PLANNING_ENGINE.md
PROCESSING_PIPELINE.md
DATA_MODEL.md
ERROR_STRATEGY.md
OBSERVABILITY.md
SECURITY.md
ROADMAP.md
SUCCESS_CRITERIA.md

No implementation should begin until these documents are internally consistent.

⸻

Phase 0 Exit Gate

Implementation may begin only if the following statement is true:

Any competent engineer could build Phase 1 without asking what the system is supposed to become.

That is the true purpose of Phase 0. It is not documentation for its own sake; it is the architectural blueprint that ensures every subsequent phase contributes to a coherent, extensible, and maintainable knowledge platform rather than a collection of disconnected features.