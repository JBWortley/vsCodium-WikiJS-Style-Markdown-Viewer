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
- [x] Run each editor's live gate with consent, inspect screenshots, and publish the clean history.

## Verification record

The initial source passed 41 public tests and 12 optional local golden comparisons.
VSCodium 1.143.1 passed all 21 live checks. VS Code 1.123.2 passed 20 checks, with its
unavailable WYSIWYG editor check skipped. All screenshots were reviewed and demo files
remained unchanged. Source, Git history and packaged output passed secret and private-data
scans. Original development history and private captures were excluded from publication.

## Review focus

- Fresh checkouts must build and run unit tests without a private wiki.
- Empty site URL must retain external links while relative wiki links work.
- Optional golden comparisons must remain strict and keep exceptions outside tracked source.
- Demo pages must cover existing live-test navigation, scrolling, copy and embed flows.
- The Git history and VSIX must exclude private content as well as the working tree.
