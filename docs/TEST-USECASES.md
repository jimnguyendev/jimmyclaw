# JimmyClaw Swarm - Test Use Cases

## Chuẩn bị

### 1. Kiểm tra môi trường
```bash
# Run test script
chmod +x test-swarm.sh
./test-swarm.sh check
```

### 2. Start JimmyClaw
```bash
# Enable swarm mode
export SWARM_ENABLED=true

# Start with Telegram
bun run src/index.ts

# Hoặc với Discord
DISCORD_BOT_TOKEN=your_token bun run src/index.ts
```

---

## Use Case 1: Swarm Commands

### 1.1 Xem trạng thái
```
/swarm status
```
**Expected:**
```
🤖 Swarm Status
Status: ✅ Enabled
Pending Tasks: 0
Processing: 0

Agents:
🟢 andy (leader)
   Model: claude-sonnet
   Tasks: 0 (0% success)
🟢 sarah (researcher)
   Model: glm-4.7-flash
   Tasks: 0 (0% success)
...
```

### 1.2 Xem agents
```
/swarm agents
```

### 1.3 Thêm agent mới
```
/swarm agent add ninja coder glm-5
```
**Expected:**
```
✅ Agent ninja added as coder using glm-5.
Use `/swarm config reload` to apply changes.
```

### 1.4 Đổi tên agent
```
/swarm agent rename mike ninja
```

### 1.5 Đổi model
```
/swarm agent model sarah claude-haiku
```

---

## Use Case 2: Research Task (Sarah)

### Input
```
@Andy tìm hiểu về mô hình multi-agent systems và cách chúng hoạt động
```

### Expected Flow
1. Andy (leader) nhận message
2. Phân loại task → "research"
3. Delegate đến Sarah (researcher)
4. Sarah research với GLM-4.7-flash
5. Trả về kết quả cho user

### Expected Response
```
Tôi đã tìm hiểu về multi-agent systems cho bạn:

**Multi-Agent Systems (MAS)** là hệ thống gồm nhiều AI agents hoạt động cùng nhau...

**Các thành phần chính:**
1. Agents - Các thực thể tự chủ
2. Environment - Môi trường hoạt động
3. Communication - Giao tiếp giữa agents
...
```

---

## Use Case 3: Code Task (Mike)

### Input
```
@Andy viết một function Python để đếm số từ trong một chuỗi
```

### Expected Flow
1. Andy → classify → "code"
2. Delegate đến Mike (coder)
3. Mike viết code với GLM-5

### Expected Response
```python
def count_words(text: str) -> int:
    """
    Đếm số từ trong một chuỗi.
    
    Args:
        text: Chuỗi cần đếm từ
        
    Returns:
        Số từ trong chuỗi
    """
    if not text or not text.strip():
        return 0
    
    words = text.strip().split()
    return len(words)

# Ví dụ sử dụng
print(count_words("Hello world from Python"))  # Output: 4
```

---

## Use Case 4: Review Task (Emma)

### Input
```
@Andy review đoạn code sau và đề xuất cải thiện:

function calc(a,b) {
  return a+b
}
```

### Expected Flow
1. Andy → classify → "review"
2. Delegate đến Emma (reviewer)

### Expected Response
```
Code review cho function `calc`:

**Vấn đề phát hiện:**
1. ❌ Thiếu type annotations
2. ❌ Function name không descriptive
3. ❌ Thiếu input validation
4. ❌ Thiếu documentation

**Code cải thiện:**
```typescript
/**
 * Tính tổng hai số
 */
function calculateSum(a: number, b: number): number {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Both arguments must be numbers');
  }
  return a + b;
}
```
```

---

## Use Case 5: Vietnamese Tasks

### Input
```
@Andy giải thích khái niệm API REST bằng tiếng Việt đơn giản
```

### Expected
- Response 100% tiếng Việt
- Giải thích dễ hiểu
- Có ví dụ thực tế

---

## Use Case 6: Complex Task (Multiple Agents)

### Input
```
@Andy research về GraphQL, sau đó viết một example code đơn giản, và review nó
```

### Expected Flow
1. Andy tạo 3 subtasks:
   - Research → Sarah
   - Code → Mike  
   - Review → Emma
2. Aggregate results
3. Return comprehensive response

---

## Use Case 7: Custom Agent

### Setup
```
/swarm agent add assistant writer glm-4.7-flash
```

### Input
```
@assistant viết một email cảm ơn khách hàng
```

### Expected
- Task routed đến "assistant" (writer role)
- Response là email template

---

## Troubleshooting

### Issue: OpenCode không work
```bash
# Check path
which opencode

# Test manually
opencode run -m zai-coding-plan/glm-4.7-flash "Hello"

# Check logs
cat store/logs/jimmyclaw.log | tail -50
```

### Issue: Swarm không enable
```bash
# Check env
echo $SWARM_ENABLED

# Set it
export SWARM_ENABLED=true
```

### Issue: Config không load
```bash
# Check config
cat data/swarm-config.json

# Reset
rm data/swarm-config.json
# Restart JimmyClaw
```

---

## Test Checklist

- [ ] OpenCode CLI working (`./test-swarm.sh quick`)
- [ ] JimmyClaw starts without errors
- [ ] `/swarm status` shows agents
- [ ] `/swarm agents` lists all agents
- [ ] Can add new agent
- [ ] Can rename agent
- [ ] Research task works
- [ ] Code task works
- [ ] Review task works
- [ ] Vietnamese responses work
- [ ] Discord channel works
- [ ] Telegram channel works
