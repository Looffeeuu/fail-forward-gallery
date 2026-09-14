# V0.1 技术架构

## 1. 目标架构

```text
浏览器：HTML + CSS + 原生 JavaScript ES Modules
        │
        ├── 公开内容 API
        ├── 登录与用户内容 API
        └── 管理后台 API
                │
        服务端应用 / Serverless Functions
        ├── 权限与输入校验
        ├── 审核编排
        ├── 邮件通知队列
        ├── 浏览量聚合与防刷
        └── 审计日志
                │
        PostgreSQL
        ├── 业务内容
        ├── 审核记录
        ├── 标签与榜单快照
        └── 通知状态

外部服务仅由服务端访问：
- 身份认证
- AI 内容分类
- 事务邮件
- 监控与错误报告
```

## 2. 前端策略

V0.1 保留现有 HTML、CSS 和原生 JavaScript，不引入 React、Vue 或构建工具。随着正式功能增加，按职责拆分为 ES Modules：

- `config`：环境和功能开关，不包含密钥。
- `api`：统一网络请求、超时、错误和身份刷新。
- `auth`：登录状态和受保护操作。
- `i18n`：中文默认、英文切换和文案目录。
- `pages`：首页、归档、投稿、个人中心和 Advice Hub。
- `components`：故事卡、筛选、弹窗、标签和状态提示。
- `state`：仅保存页面交互状态，不作为正式数据库。

用户生成内容默认不进入界面翻译目录，防止平台擅自改变作者表达。

## 3. API 边界

建议从版本化 API 开始：

- `POST /v1/auth/*`
- `GET /v1/stories`
- `POST /v1/stories`
- `GET /v1/me/stories`
- `POST /v1/stories/:id/comments`
- `POST /v1/stories/:id/follow-ups`
- `POST /v1/content/:type/:id/appeals`
- `POST /v1/content/:type/:id/removal-requests`
- `GET /v1/tags`
- `POST /v1/tag-proposals`
- `GET /v1/rankings`
- `GET /v1/advice`
- `GET /v1/admin/moderation-cases`
- `POST /v1/admin/moderation-cases/:id/decision`

所有写入接口执行服务端 schema 校验、权限校验、频率限制和幂等控制。

## 4. 审核适配层

前端不能直接调用 AI 服务。服务端定义稳定接口：

```text
moderateContent(content, context)
→ riskCategories
→ recommendedRoute
→ userReasonCode
→ providerMetadata
```

供应商返回内容必须转换为平台自己的分类，不让业务状态依赖某家模型的字段。AI 调用失败时内容进入人工审核，不应自动公开。

## 5. 邮件适配层

```text
enqueueNotification(templateId, userId, variables)
→ email_outbox
→ background worker
→ transactional email provider
```

请求主流程不等待邮件成功；邮件失败可以重试，但不能导致内容重复提交。

## 6. 环境

- `local`：开发机；允许使用明确标记的测试数据。
- `staging`：与生产结构一致，使用测试账户和独立数据库。
- `production`：真实用户数据；只有受控发布流程可以更新。

各环境必须使用不同数据库、认证配置、AI 密钥和邮件发送域。任何密钥不得进入 Git、浏览器脚本或错误截图。

## 7. 可观测性

正式版本至少记录：

- API 成功率、延迟和错误码；
- 审核队列长度和等待时间；
- AI 分类失败率；
- 邮件发送状态；
- 榜单聚合任务状态；
- 管理员敏感操作审计。

日志不得记录完整正文、邮箱、访问令牌或未经处理的 AI 请求。

## 8. 发布顺序

1. 建立 staging 数据库、认证和最小 API。
2. 实现投稿前确认、登录和 My Stories。
3. 实现故事审核队列与人工发布。
4. 接入 AI 分类适配层和邮件通知。
5. 实现评论与 Follow-up。
6. 实现自定义标签、榜单和 Advice Hub 管理。
7. 完成隐私、安全、负载、无障碍和移动端验收后再开放生产环境。

## 9. 上线前未决事项

- 后端和数据库供应商、部署地区及数据驻留要求。
- 邮箱认证方式与正式发信域名。
- 审核员人数、工作时段和目标响应时间。
- 数据保留、删除和备份期限。
- 适用于目标用户地区的隐私条款与危机资源维护责任人。
- AI 服务供应商的数据使用、保留和跨境处理条款。

