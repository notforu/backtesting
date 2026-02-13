---
name: research
description: Research a topic using web search and analysis. Use for finding best practices, comparing libraries, investigating technologies, or answering technical questions.
allowed-tools: WebSearch, WebFetch, Read, Glob, Grep
---

Research topic: `$ARGUMENTS`

## Research workflow:

1. **Clarify scope**: Understand exactly what needs to be researched
2. **Web search**: Search for recent, authoritative sources (prioritize official docs, GitHub, reputable blogs)
3. **Cross-reference**: Verify claims across multiple sources
4. **Summarize findings**: Present a clear, actionable summary

## Output format:

### Summary
Brief overview of findings (2-3 sentences)

### Key findings
- Bullet points of the most important discoveries
- Include specific versions, numbers, or benchmarks when available

### Recommendations
- What action to take based on the research
- Trade-offs to consider

### Sources
- List all URLs consulted with brief descriptions
- Prefer sources from the last 12 months

## Rules:
- Always include publication dates when referencing articles
- Flag any conflicting information between sources
- Distinguish between facts, opinions, and speculation
- If the topic is rapidly evolving, note the current date and suggest re-checking later
