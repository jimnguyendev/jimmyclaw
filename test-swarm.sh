#!/bin/bash

# ============================================
# NanoClaw Swarm Test Script
# Cách dùng: ./test-swarm.sh [scenario]
# ============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     NanoClaw Swarm - Test Scenarios       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

# Check prerequisites
check_prerequisites() {
    echo -e "\n${YELLOW}[1] Checking prerequisites...${NC}"
    
    # Check bun
    if command -v bun &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Bun: $(bun --version)"
    else
        echo -e "  ${RED}✗${NC} Bun not found"
        exit 1
    fi
    
    # Check opencode
    if command -v opencode &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} OpenCode: $(opencode --version)"
    else
        echo -e "  ${RED}✗${NC} OpenCode not found"
        exit 1
    fi
    
    # Check .env
    if [ -f ".env" ]; then
        echo -e "  ${GREEN}✓${NC} .env file exists"
    else
        echo -e "  ${YELLOW}!${NC} .env file not found (will use defaults)"
    fi
    
    echo -e "  ${GREEN}✓${NC} All prerequisites met!"
}

# Test OpenCode CLI directly
test_opencode() {
    echo -e "\n${YELLOW}[2] Testing OpenCode CLI...${NC}"
    
    echo -e "  Testing with glm-4.7-flash (free model)..."
    opencode run -m zai-coding-plan/glm-4.7-flash --format json "Say hello in Vietnamese" 2>&1 | head -20
    
    echo -e "\n  ${GREEN}✓${NC} OpenCode CLI working!"
}

# Test Swarm Commands via Telegram/Discord simulation
test_swarm_commands() {
    echo -e "\n${YELLOW}[3] Swarm Commands to test manually:${NC}"
    
    echo -e "
${BLUE}=== Basic Commands ===${NC}
/swarm status          - Xem trạng thái swarm
/swarm agents          - Liệt kê agents
/swarm models          - Xem models có sẵn
/swarm roles           - Xem roles có sẵn
/swarm help            - Xem help

${BLUE}=== Agent Management ===${NC}
/swarm agent add ninja coder glm-5
/swarm agent rename mike ninja
/swarm agent model sarah claude-haiku
/swarm agent remove ninja

${BLUE}=== Config Management ===${NC}
/swarm config show     - Xem config hiện tại
/swarm config set maxParallelTasks 8
/swarm config reset    - Reset về default
/swarm config reload   - Reload config
"
}

# Test scenarios
test_research() {
    echo -e "\n${YELLOW}[4] Research Task Test${NC}"
    echo -e "
${BLUE}Gửi tin nhắn:${NC}
@Andy tìm hiểu về AI agents và multi-agent systems

${BLUE}Expected:${NC}
- Leader (Andy) nhận task
- Delegate đến Sarah (researcher)
- Sarah research và trả về kết quả
"
}

test_code() {
    echo -e "\n${YELLOW}[5] Code Task Test${NC}"
    echo -e "
${BLUE}Gửi tin nhắn:${NC}
@Andy viết một function JavaScript để tính fibonacci

${BLUE}Expected:${NC}
- Leader nhận task
- Delegate đến Mike (coder)
- Mike viết code và giải thích
"
}

test_review() {
    echo -e "\n${YELLOW}[6] Review Task Test${NC}"
    echo -e "
${BLUE}Gửi tin nhắn:${NC}
@Andy review đoạn code sau và đề xuất cải thiện:
\`\`\`javascript
function add(a, b) {
  return a + b
}
\`\`\`

${BLUE}Expected:${NC}
- Leader nhận task
- Delegate đến Emma (reviewer)
- Emma review và đưa feedback
"
}

test_vietnamese() {
    echo -e "\n${YELLOW}[7] Vietnamese Task Test${NC}"
    echo -e "
${BLUE}Gửi tin nhắn:${NC}
@Andy viết một bài giới thiệu ngắn về TypeScript bằng tiếng Việt

${BLUE}Expected:${NC}
- Agent trả lời bằng tiếng Việt
- Nội dung chất lượng
"
}

# Run all tests
run_all() {
    check_prerequisites
    test_opencode
    test_swarm_commands
    test_research
    test_code
    test_review
    test_vietnamese
    
    echo -e "\n${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Test scenarios ready!${NC}"
    echo -e "${GREEN}  Start NanoClaw and test via Telegram/Discord${NC}"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
}

# Quick test - run OpenCode directly
quick_test() {
    echo -e "\n${YELLOW}Quick Test - OpenCode CLI${NC}"
    echo -e "Testing free model (glm-4.7-flash)...\n"
    
    opencode run -m zai-coding-plan/glm-4.7-flash "Trả lời: 1+1=? Chỉ trả lời số."
}

# Main
case "${1:-all}" in
    "check")
        check_prerequisites
        ;;
    "opencode")
        test_opencode
        ;;
    "commands")
        test_swarm_commands
        ;;
    "quick")
        quick_test
        ;;
    "all"|*)
        run_all
        ;;
esac
