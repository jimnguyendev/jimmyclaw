---
phase: requirements
title: CLI Dashboard
description: Yêu cầu cho interactive terminal UI và command-line interface
status: planned
---

# Requirements: CLI Dashboard

## Bối cảnh

JimmyClaw chạy trên VPS như một daemon. Người dùng kỹ thuật quản lý qua SSH — không có browser, không cần web UI. Mọi tác vụ cấu hình và monitor phải thực hiện được từ terminal.

## Yêu cầu chức năng

### FR-1: Command-line interface

| ID | Yêu cầu |
|----|---------|
| FR-1.1 | Người dùng gõ `jimmyclaw <command>` để thực hiện tác vụ mà không cần mở Telegram/Discord |
| FR-1.2 | Tất cả cấu hình hiện có (agent, config, env, channel, service) phải có command tương ứng |
| FR-1.3 | Mọi command phải hỗ trợ flag `--json` để output dạng JSON cho scripting |
| FR-1.4 | Command sai hoặc thiếu argument phải in hướng dẫn rõ ràng |
| FR-1.5 | `jimmyclaw --help` và `jimmyclaw <command> --help` hoạt động đầy đủ |

### FR-2: Interactive prompts

| ID | Yêu cầu |
|----|---------|
| FR-2.1 | Khi gọi command thiếu argument, CLI hỏi từng bước thay vì báo lỗi |
| FR-2.2 | Chọn model phải hiển thị giá tiền và label rõ ràng |
| FR-2.3 | Các thao tác phá hủy (remove agent, reset config) phải confirm trước khi thực hiện |
| FR-2.4 | Input validation inline — báo lỗi ngay khi nhập sai |

### FR-3: TUI dashboard

| ID | Yêu cầu |
|----|---------|
| FR-3.1 | `jimmyclaw` không có argument mở TUI fullscreen |
| FR-3.2 | TUI hiển thị trạng thái agents (idle/busy), task queue, activity log, thông tin hệ thống |
| FR-3.3 | Dữ liệu tự refresh không cần thao tác người dùng |
| FR-3.4 | Keyboard shortcuts để thực hiện các tác vụ thường dùng |
| FR-3.5 | Thoát TUI không dừng daemon |

### FR-4: Realtime log viewer

| ID | Yêu cầu |
|----|---------|
| FR-4.1 | `jimmyclaw logs` tail log realtime |
| FR-4.2 | Filter theo agent ID |
| FR-4.3 | Filter theo log level (debug/info/warn/error) |
| FR-4.4 | Filter theo khoảng thời gian (`--since 1h`) |
| FR-4.5 | Highlight màu theo level |

### FR-5: Service management

| ID | Yêu cầu |
|----|---------|
| FR-5.1 | `jimmyclaw start/stop/restart` quản lý daemon |
| FR-5.2 | `jimmyclaw service install` đăng ký launchd (macOS) hoặc systemd (Linux) tự động |
| FR-5.3 | Hiển thị trạng thái daemon (running/stopped/error) |

## Yêu cầu phi chức năng

| ID | Yêu cầu |
|----|---------|
| NFR-1 | CLI khởi động trong < 200ms |
| NFR-2 | Không import runtime code của daemon — tách biệt hoàn toàn |
| NFR-3 | Hoạt động khi daemon không chạy (in thông báo rõ ràng thay vì crash) |
| NFR-4 | TUI hoạt động trên terminal 80x24 trở lên |
| NFR-5 | Không yêu cầu cấu hình thêm — tự tìm socket path từ PROJECT_ROOT |

## Không trong scope

- Web UI hoặc browser-based dashboard
- Remote management qua HTTP/HTTPS
- Authentication cho CLI (local Unix socket, bảo mật bằng file permissions)
- Mobile app
