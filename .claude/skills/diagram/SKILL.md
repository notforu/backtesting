---
name: diagram
description: Generate architecture diagrams, flow charts, sequence diagrams, or ERD diagrams. Use when the user wants to visualize code structure, data flow, or system architecture.
---

Generate a diagram for: `$ARGUMENTS`

## Diagram types (choose the most appropriate):

### Architecture diagram
Use for system overview, service relationships, component structure.

### Sequence diagram
Use for request/response flows, API calls, event chains.

### Flowchart
Use for decision logic, process flows, state machines.

### ERD (Entity Relationship)
Use for database schemas, data models, type relationships.

## Output format:
1. **Mermaid diagram** (primary) - renders in GitHub, most docs tools, and IDEs
2. **ASCII art** (fallback) - for quick terminal-friendly diagrams

## Rules:
- Always use Mermaid syntax wrapped in ```mermaid code blocks
- Keep diagrams focused - split large systems into sub-diagrams
- Add brief labels on all connections/arrows
- Include a legend if using colors or special notation
- After the diagram, add a brief text explanation of the key relationships

If no specific target is given, analyze the current project and create an architecture overview.
