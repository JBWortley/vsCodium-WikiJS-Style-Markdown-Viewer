# Public repository cleanup plan

> **For agentic workers:** Use superpowers:executing-plans to carry out this cleanup and superpowers:requesting-code-review before publication.

**Goal:** Publish a portable Wiki.js-style Markdown viewer without the original maintainer's private data or Git history.

**Architecture:** Prepare a separate repository from tracked source files only. Keep the existing renderer and security layers; replace site-specific configuration, documentation and test data with explicit configuration and synthetic fixtures.

**Tech stack:** TypeScript, esbuild, Vitest, VSCodium and VS Code extension APIs.

**Spec:** The requested privacy cleanup and public GitHub publication; repository rules in AGENTS.md.

## Constraints

- Preserve read-only Markdown handling, pinned renderer dependencies, worker timeout, CSP, sanitizers and safe link opening.
- Exclude private captures, local paths, customer examples, credentials and previous commit metadata from the new repository.
- Preserve third-party copyright and license attribution.
- Never launch desktop tests without express consent for each run.

## Tasks

- [x] Audit the source, history, package contents and dependency notices.
- [x] Replace private defaults and fixtures; document setup, limitations and licensing.
- [x] Run clean-install checks, private golden comparisons, packaging checks and a privacy scan.
- [x] Obtain an independent review and resolve material findings.
- [ ] Run each editor's live gate with consent, inspect screenshots, and publish only the clean initial commit.

## Review focus

- Fresh checkouts must build and run unit tests without a private wiki.
- Empty site URL must retain external links while relative wiki links work.
- Optional golden comparisons must remain strict and keep exceptions outside tracked source.
- Demo pages must cover existing live-test navigation, scrolling, copy and embed flows.
- The Git history and VSIX must exclude private content as well as the working tree.
