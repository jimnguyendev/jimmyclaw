---
phase: requirements
title: Channel-Based Agent Communication
description: Yêu cầu cho hệ thống agents giao tiếp qua Discord/Telegram channel
status: planned
---

# Requirements: Channel-Based Agent Communication

## Bối cảnh

Agents hiện giao tiếp qua SQLite message queue ẩn — người dùng không thấy. Khi chạy nhiều JimmyClaw instance trên nhiều VPS, agents giữa các instance không thể phối hợp. Mục tiêu: dùng Discord hoặc Telegram channel làm kênh giao tiếp chính, visible và cross-VPS.

## Yêu cầu chức năng

### FR-1: Bot identity per agent

| ID | Yêu cầu |
|----|---------|
| FR-1.1 | Mỗi agent có bot riêng trên Discord hoặc Telegram |
| FR-1.2 | Bot dùng tên của agent (Nam, Linh, Duc...) làm display name |
| FR-1.3 | Người dùng thấy rõ agent nào đang nói trong channel |
| FR-1.4 | Cấu hình token cho từng agent trong `config/agent-swarm.json` |

### FR-2: Giao tiếp qua channel

| ID | Yêu cầu |
|----|---------|
| FR-2.1 | Agents post message lên channel thay vì dùng SQLite queue ẩn |
| FR-2.2 | Message theo format chuẩn: `@target [type] nội dung` |
| FR-2.3 | Agents đọc @mention của mình và xử lý task tương ứng |
| FR-2.4 | Channel log là audit trail đầy đủ của team workflow |

### FR-3: Cross-VPS collaboration

| ID | Yêu cầu |
|----|---------|
| FR-3.1 | Instance A delegate task cho agent trên Instance B qua channel |
| FR-3.2 | Mỗi instance chỉ xử lý @mention đến agents của mình |
| FR-3.3 | Kết quả từ Instance B được Instance A nhận qua channel |
| FR-3.4 | Cấu hình `INSTANCE_ID` và `INSTANCE_AGENTS` để phân biệt instance |

### FR-4: Human-in-the-loop

| ID | Yêu cầu |
|----|---------|
| FR-4.1 | Người dùng post vào channel → agents nhận và xử lý như interruption |
| FR-4.2 | `@leader dừng lại, đổi hướng` → leader cancel pending tasks và re-plan |
| FR-4.3 | `@agent thêm context: ...` → agent inject thêm context vào task đang chạy |
| FR-4.4 | Phân biệt human message vs bot message bằng sender type |

### FR-5: Shared workspace

| ID | Yêu cầu |
|----|---------|
| FR-5.1 | Thư mục `groups/workspace/` được mount read/write vào tất cả agent containers |
| FR-5.2 | Agents ghi output dài (> 400 chars) ra file trong `workspace/docs/` |
| FR-5.3 | Agents đọc file của nhau qua đường dẫn được mention trên channel |
| FR-5.4 | System prompt hướng dẫn agent khi nào dùng file vs paste trực tiếp |

### FR-6: Custom agent names

| ID | Yêu cầu |
|----|---------|
| FR-6.1 | Người dùng đặt tên agent tùy ý trong config |
| FR-6.2 | Telegram bot tự đổi display name theo agent id khi lần đầu gửi |
| FR-6.3 | Discord bot dùng username của Application tương ứng |

## Yêu cầu phi chức năng

| ID | Yêu cầu |
|----|---------|
| NFR-1 | Không mất message khi một instance restart |
| NFR-2 | Timeout rõ ràng khi agent trên VPS khác không trả lời (mặc định 2 phút) |
| NFR-3 | Fallback về local agent cùng role nếu remote agent timeout |
| NFR-4 | Rate limit Discord/Telegram được xử lý bằng exponential backoff |
| NFR-5 | Không tạo message loop (agent reply → trigger lại chính nó) |
| NFR-6 | SQLite message log vẫn giữ để audit, channel là primary transport |

## Không trong scope

- Agents giao tiếp qua email hoặc SMS
- Encryption end-to-end cho agent messages
- Agent memory sharing giữa các instance (chỉ message passing)
- Web-based team channel viewer
