---
name: deploy
description: Deploy or release the application. Use for production deployments, staging pushes, or release workflows.
disable-model-invocation: true
---

Deploy workflow for `$ARGUMENTS`:

## Pre-deploy checks
1. Run the full test suite - abort if any failures
2. Run type checking and linting
3. Check for uncommitted changes - warn if any exist
4. Verify the current branch (should be main/master unless specified)

## Build
5. Create a production build
6. Verify build output exists and looks correct

## Deploy
7. Execute the deployment (follow project-specific deploy scripts)
8. Verify deployment succeeded (health check if available)

## Post-deploy
9. Tag the release if applicable
10. Update changelog

**IMPORTANT**: Always confirm with user before executing irreversible deployment steps.
If no deployment target is configured, ask the user how they deploy.
