# Anti-Hallucination Troubleshooting

## Common Issues

### Agent Still Hallucinating

**Symptoms:** Agent invents phone numbers, emails, dates, or other facts.

**Possible Causes:**
1. Rules not loaded (CLAUDE.md not read)
2. Model ignoring instructions
3. Query too ambiguous

**Solutions:**
1. Verify CLAUDE.md contains the Anti-Hallucination Rules section
2. Try rephrasing the query to be more specific
3. For persistent issues, strengthen the language in CLAUDE.md:
   ```markdown
   ### What to NEVER Do
   
   **CRITICAL - Violations will cause session termination:**
   - Invent phone numbers, emails, or addresses
   ```

### Agent Says "I Don't Know" Too Often

**Symptoms:** Agent refuses to answer even when it should know.

**Possible Causes:**
1. Memory files not being read
2. Information exists but in unexpected location
3. Rules too strict

**Solutions:**
1. Check if MEMORY.md or knowledge/ files exist
2. Tell agent where to look: "Check the contacts.md file for John's info"
3. Adjust confidence thresholds in CLAUDE.md

### Citation Format Wrong

**Symptoms:** Citations missing or in wrong format.

**Possible Causes:**
1. Agent didn't follow format instructions
2. Multiple sources confused formatting

**Solutions:**
1. Reinforce format with example: "Use the citation format from your rules"
2. Check CLAUDE.md has correct citation examples

### Over-Cautious Responses

**Symptoms:** Agent labels everything as "[Uncertain]" even verified facts.

**Possible Causes:**
1. Rules too aggressive
2. Agent can't find exact match in memory

**Solutions:**
1. Ensure memory files have clear, unambiguous information
2. Adjust rules to be less strict for high-confidence scenarios

## Testing Checklist

Use these queries to verify anti-hallucination is working:

| Query Type | Example | Expected Response |
|------------|---------|-------------------|
| Known fact | "What's my timezone?" | Citation + answer OR "not found" |
| Unknown fact | "What's my blood type?" | "I don't have this information" |
| Speculative | "Will it rain?" | Uncertainty label or "I don't know" |
| Ambiguous | "What's John's number?" | Clarification request |

## Debug Mode

To see what the agent is searching before responding:

1. Ask: "Before answering, show me what files you searched"
2. Check container logs in `groups/main/logs/`

## Reporting Issues

If hallucination persists:

1. Save the full conversation transcript
2. Note the exact query that caused hallucination
3. Check if memory files contain conflicting info
4. Report with label `bug:hallucination`
