# V0.1 数据模型

正式数据库建议使用关系型数据库。所有 ID 使用不可预测的 UUID，时间使用 UTC 保存，界面按用户时区显示。

## 1. 身份与同意

### `users`

- `id`
- `auth_subject`：认证服务中的主体 ID，仅服务器可用
- `status`：active / suspended / deleted
- `created_at`
- `updated_at`

邮箱由认证服务管理，业务表和公开 API 不重复保存明文邮箱，除非邮件服务集成确有必要且经过专门安全评审。

### `consent_records`

- `id`
- `user_id`
- `policy_type`
- `policy_version`
- `accepted_at`
- `withdrawn_at`

用于记录“动笔之前”、社区规范和隐私政策的版本化确认。

## 2. 内容

### `stories`

- `id`
- `author_user_id`
- `board_id`
- `title`
- `body`
- `response_preference`
- `visibility`
- `moderation_status`
- `published_at`
- `created_at`
- `updated_at`
- `withdrawn_at`
- `deleted_at`

### `comments`

- `id`
- `story_id`
- `author_user_id`
- `body`
- `moderation_status`
- `published_at`
- `created_at`
- `updated_at`
- `withdrawn_at`
- `deleted_at`

服务端在创建评论时必须重新检查故事的 `response_preference`，不能只依赖前端隐藏输入框。

### `follow_ups`

- `id`
- `story_id`
- `author_user_id`
- `current_status`
- `body`
- `support_needed`
- `visibility`
- `moderation_status`
- `published_at`
- `created_at`
- `updated_at`
- `deleted_at`

服务端必须验证 `follow_ups.author_user_id` 与原故事作者一致。

### `content_revisions`

- `id`
- `content_type`
- `content_id`
- `revision_number`
- `title_snapshot`
- `body_snapshot`
- `created_by_user_id`
- `created_at`

用于在修改、申诉和复核时保存可审计版本；不向公开 API 暴露。

## 3. 板块与标签

### `boards`

- `id`
- `slug`
- `label_zh`
- `label_en`
- `description_zh`
- `description_en`
- `is_active`

### `tags`

- `id`
- `slug`
- `label_zh`
- `label_en`
- `status`：official / proposed / pending_promotion / rejected / archived
- `created_by_user_id`
- `approved_by_admin_id`
- `created_at`

### `tag_boards`

- `tag_id`
- `board_id`

### `story_tags`

- `story_id`
- `tag_id`
- `source`：official_selection / user_proposal

### `tag_proposal_usage`

- `tag_id`
- `user_id`
- `story_id`
- `created_at`

晋升计数只统计不同用户在已批准故事中的使用，并需要防止大小写、空格和同义词重复。

## 4. 审核与举报

### `moderation_cases`

- `id`
- `content_type`
- `content_id`
- `status`
- `priority`
- `rule_version`
- `assigned_moderator_id`
- `created_at`
- `resolved_at`

### `ai_moderation_results`

- `id`
- `moderation_case_id`
- `provider`
- `model_version`
- `risk_categories`
- `confidence_summary`
- `recommended_route`
- `created_at`

不保存模型隐藏推理；只保存审核所需的结构化分类结果。

### `moderation_events`

- `id`
- `moderation_case_id`
- `actor_type`
- `actor_id`
- `from_status`
- `to_status`
- `reason_code`
- `note`
- `created_at`

### `appeals`

- `id`
- `content_type`
- `content_id`
- `user_id`
- `message`
- `status`
- `resolved_by_admin_id`
- `created_at`
- `resolved_at`

### `content_reports`

- `id`
- `content_type`
- `content_id`
- `reporter_user_id`
- `reason_code`
- `details`
- `status`
- `created_at`

## 5. 通知与邮件

### `notifications`

- `id`
- `user_id`
- `type`
- `content_type`
- `content_id`
- `status`
- `created_at`
- `read_at`

### `email_outbox`

- `id`
- `user_id`
- `template_id`
- `template_variables`
- `status`
- `attempt_count`
- `last_error_code`
- `created_at`
- `sent_at`

`template_variables` 不保存完整投稿正文。

## 6. 浏览与榜单

### `view_events`

- `id`
- `story_id`
- `anonymous_session_hash`
- `occurred_at`
- `is_probable_bot`

哈希应使用服务器密钥和短期轮换策略，不保存原始 IP 作为长期榜单标识。

### `story_metrics_daily`

- `story_id`
- `metric_date`
- `unique_views`
- `approved_comment_count`
- `approved_follow_up_count`

### `ranking_snapshots`

- `id`
- `ranking_type`
- `window_start`
- `window_end`
- `generated_at`
- `items`

## 7. Advice Hub

### `advice_articles`

- `id`
- `slug`
- `title_zh`
- `title_en`
- `summary_zh`
- `summary_en`
- `body_zh`
- `body_en`
- `status`
- `owner_admin_id`
- `published_at`
- `last_reviewed_at`

### `advice_sources`

- `id`
- `article_id`
- `title`
- `url`
- `publisher`
- `published_at`
- `verified_at`

## 8. 权限底线

- 公开读取只允许 `published` 且 `visibility = public` 的内容。
- 登录用户只能读取自己的非公开内容和状态。
- 审核员只能通过受保护后台访问审核数据。
- AI 和邮件供应商密钥只存在于服务器环境。
- 删除采用先软删除、再按正式保留政策清理的方式；具体期限在隐私政策确认后填写。

