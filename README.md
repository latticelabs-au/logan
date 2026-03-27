<div align="center">

# Logan — AI Security Remediation Framework

### *Every Shannon needs a Logan.*

**Forked from [Shannon](https://github.com/KeygraphHQ/shannon) by [Keygraph](https://keygraph.io)**

Logan is an autonomous, AI-powered security remediation agent that **fixes vulnerabilities found by Shannon audits**. It parses Shannon's pentest reports, plans and implements code fixes across all vulnerability categories, validates fixes by re-running the full Shannon pipeline, and generates a pull request with before/after comparison.

[![Forked from Shannon](https://img.shields.io/badge/Forked%20from-Shannon-blue?style=flat-square)](https://github.com/KeygraphHQ/shannon)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-green?style=flat-square)](LICENSE)

</div>

---

## How It Works

Logan takes Shannon's audit output as input and runs a structured multi-agent pipeline to systematically fix every confirmed vulnerability:

```
Shannon Audit Report
        │
        ▼
┌──────────────┐
│   TRIAGE     │  Parse findings, prioritize, group by root cause
└──────┬───────┘
       ▼
┌──────────────┐
│  FIX PLAN    │  Map each vuln to exact code changes needed
└──────┬───────┘
       ▼
┌──────┴───────────────────────────────────┐
│         FIX IMPLEMENTATION (parallel)     │
├──────────┬──────────┬──────────┬─────────┤
│Injection │   XSS    │   Auth   │  SSRF   │  Authz
│  Fixer   │  Fixer   │  Fixer   │  Fixer  │  Fixer
└──────────┴──────────┴──────────┴─────────┘
       │
       ▼
┌──────────────┐
│  FIX REVIEW  │  Check completeness, correctness, regressions
└──────┬───────┘
       ▼
┌──────────────┐
│   SHANNON    │  Re-run full Shannon pipeline on fixed code
│  VALIDATION  │
└──────┬───────┘
       ▼
┌──────────────┐
│   COMPARE    │  Diff before/after: FIXED, PARTIAL, UNFIXED, REGRESSION
└──────┬───────┘
       ▼
┌──────────────┐
│    REPORT    │  Executive remediation report + PR description
└──────────────┘
```

## What Logan Fixes

| Category | Fix Strategies |
|----------|---------------|
| **SQL/Command Injection** | Parameterized queries, prepared statements, command arrays, input validation |
| **Cross-Site Scripting** | Context-specific output encoding, CSP headers, DOMPurify, template autoescaping |
| **Authentication** | Session rotation, cookie flags (HttpOnly/Secure/SameSite), rate limiting, HSTS |
| **SSRF** | URL allowlisting, private IP blocking, protocol restriction, redirect validation |
| **Authorization** | Ownership middleware, RBAC guards, tenant isolation, workflow state validation |

## Prerequisites

- **Docker** — [Install Docker](https://docs.docker.com/get-docker/)
- **Anthropic API key** — [Get from Anthropic Console](https://console.anthropic.com)
- **A completed Shannon audit** — Logan needs Shannon's output to know what to fix

## Quick Start

```bash
# 1. Clone Logan
git clone https://github.com/latticelabs-au/logan.git
cd logan

# 2. Configure credentials
cat > .env << 'EOF'
ANTHROPIC_API_KEY=your-api-key
CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
EOF

# 3. Prepare your repo (must have Shannon's deliverables/ directory)
ln -s /path/to/your/audited-repo ./repos/my-repo

# 4. Run remediation
./logan start URL=https://your-app.com REPO=my-repo
```

## CLI Reference

```bash
# Start a remediation workflow
./logan start URL=<url> REPO=<name>

# With configuration
./logan start URL=<url> REPO=<name> CONFIG=./configs/my-config.yaml

# Named workspace (supports resume)
./logan start URL=<url> REPO=<name> WORKSPACE=q1-fixes

# Resume an interrupted run
./logan start URL=<url> REPO=<name> WORKSPACE=q1-fixes

# List all workspaces
./logan workspaces

# View real-time logs
./logan logs ID=<workflow-id>

# Stop containers
./logan stop

# Full cleanup
./logan stop CLEAN=true
```

## Pipeline Phases

### Phase 1: Triage
Parses Shannon's `comprehensive_security_assessment_report.md` and all exploitation queue JSONs. Classifies findings as EXPLOITED (must fix), POTENTIAL (should fix), or informational (skip). Groups vulnerabilities sharing the same root cause into fix groups.

### Phase 2: Fix Planning
Takes the prioritized remediation plan and maps each fix group to exact code changes. Creates a dedicated git branch (`logan/remediation-{timestamp}`) and generates per-type fix specifications with file paths, change descriptions, and test strategies.

### Phase 3: Fix Implementation (5 parallel agents)
Five specialist agents work in parallel, each focused on one vulnerability category. Each agent reads Shannon's detailed analysis (source-to-sink traces, code locations) and applies surgical fixes to the actual source code. Fixes include inline comments referencing the original vulnerability ID.

### Phase 4: Fix Review
Reviews all changes from the 5 fix agents for completeness, correctness, conflicts, and regressions. Runs the test suite if available. Creates clean atomic commits per fix group.

### Phase 5: Shannon Validation
The key differentiator — re-runs the **full Shannon pentest pipeline** against the patched codebase. This proves fixes actually work, not just that code was changed.

### Phase 6: Comparison
Compares Shannon's original findings with the post-fix validation results. For each original vulnerability, determines: **FIXED** (no longer found), **PARTIALLY_FIXED** (severity reduced), **UNFIXED** (still present), or **REGRESSION** (new vulnerability introduced). Calculates overall fix rate.

### Phase 7: Reporting
Generates an executive remediation report with fix metrics, code diff snippets, before/after comparison, remaining risk assessment, and a PR-ready description.

## Output

```
deliverables/
├── remediation_plan.json                # Prioritized fix plan
├── fix_specifications.json              # Per-type fix specs
├── injection_fix_report.md              # Injection fixes applied
├── xss_fix_report.md                    # XSS fixes applied
├── auth_fix_report.md                   # Auth fixes applied
├── ssrf_fix_report.md                   # SSRF fixes applied
├── authz_fix_report.md                  # Authz fixes applied
├── fix_review_report.md                 # Review of all fixes
├── shannon_validation_report.md         # Shannon re-run results
├── comparison_report.json               # Before/after diff matrix
└── remediation_report.md                # Executive report
```

## Relationship to Shannon

Logan is forked from [Shannon](https://github.com/KeygraphHQ/shannon), the open-source AI penetration testing framework by [Keygraph](https://keygraph.io). It reuses Shannon's infrastructure:

- **Temporal orchestration** for durable workflow execution with crash recovery
- **Claude Agent SDK** integration for AI-powered code analysis and modification
- **Audit logging system** for tracking all agent activity
- **MCP tooling** for deliverable management
- **Resume/workspace system** for interrupted runs

The key difference: Shannon **finds** vulnerabilities through exploitation. Logan **fixes** them through code remediation and validates the fixes by running Shannon again.

| | Shannon | Logan |
|---|---|---|
| **Purpose** | Find vulnerabilities | Fix vulnerabilities |
| **Agents** | 13 (recon, analysis, exploit, report) | 11 (triage, plan, fix, review, validate, compare, report) |
| **Output** | Pentest report with PoCs | Remediation report with code patches + PR |
| **Validation** | Exploit proves vuln exists | Shannon re-run proves vuln is fixed |

## Configuration

Logan uses the same YAML configuration format as Shannon. See Shannon's [configuration docs](https://github.com/KeygraphHQ/shannon#configuration-optional) for authentication setup, TOTP, and other options.

Additional Logan-specific options:

```yaml
# configs/my-config.yaml
remediation:
  fix_branch_prefix: "logan/fix"     # Git branch prefix for fixes
  run_tests: true                     # Run test suite after fixes
  shannon_validation: true            # Re-run Shannon (default: true)
```

## Cloud Provider Support

Logan supports the same cloud providers as Shannon:
- **Anthropic API** (recommended)
- **AWS Bedrock**
- **Google Vertex AI**
- **Custom Base URL** (proxies, gateways)

See Shannon's [provider setup docs](https://github.com/KeygraphHQ/shannon#aws-bedrock) for configuration details.

## License

Logan is released under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE), the same license as Shannon.

## Credits

- **[Shannon](https://github.com/KeygraphHQ/shannon)** by [Keygraph](https://keygraph.io) — the AI pentesting framework Logan is forked from
- **[Anthropic Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)** — the AI reasoning engine
- **[Temporal](https://temporal.io)** — durable workflow orchestration

---

<p align="center">
  <b>Built by <a href="https://github.com/latticelabs-au">Lattice Labs</a></b><br>
  <i>Forked with ❤️ from <a href="https://github.com/KeygraphHQ/shannon">Shannon</a> by <a href="https://keygraph.io">Keygraph</a></i>
</p>
