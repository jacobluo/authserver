# 管理后台账号登录设计

日期：2026-09-18

## 目标与现状

管理后台目前要求输入 `AUTHPLANE_ADMIN_API_KEY`。前端将该密钥放入 `sessionStorage`，随后在每个管理请求中发送 Bearer 头。用户表已经支持本地密码和 `admin` 角色，CLI 也能创建管理员，但管理 API 目前只识别 API Key 或外部注入的认证策略，不识别管理员账号。

目标是让已有 `admin` 用户以邮箱和密码登录管理后台；不改变普通用户的 OAuth 登录流程，也不取消自动化脚本使用的 API Key。

## 方案选择

采用现有用户表和密码验证服务，为管理后台新增独立会话。固定的单一管理员密码不支持多人管理；直接复用普通 OAuth 会话则混淆资源所有者登录和管理权限。独立会话在复用账号的同时保持权限边界。

首个管理员仍由 CLI 创建，角色明确指定为 `admin`。管理后台的「新增用户」功能继续只创建普通 `user`，不在未登录页面提供管理员注册入口。

## 请求流程与接口

1. 页面加载时调用 `GET /admin/auth/me`。有效管理员会话返回账号信息及 CSRF 令牌；其他情况返回 `401`，显示邮箱密码登录页。
2. 登录页向 `POST /admin/auth/login` 发送 JSON 格式的邮箱和密码。服务端调用已有密码验证服务，并检查账号为启用状态且角色为 `admin`。认证通过后建立新的管理会话，返回账号信息及 CSRF 令牌；失败统一返回不泄露账号存在性或角色的错误。
3. 管理 API 同时接受原有 Bearer API Key 和新的管理员会话。请求显式携带 Bearer 头时只按 API Key 验证，错误密钥不能回退到 Cookie。无 Bearer 头时才检查管理员会话。现有 `OptionalDeps.Auth` 外部认证注入策略保持优先，不被默认策略覆盖；注入该策略时不开放本地账号登录接口。
4. `POST /admin/auth/logout` 撤销当前管理会话并清除 Cookie。前端退出后回到登录页。API Key 的现有调用方式不变。
5. 静态页面 `GET /admin/ui/` 继续允许未登录访问，以便显示登录页；其他管理业务接口仍由服务端认证中间件保护。

账号登录只用于管理端口。普通 OAuth 登录 Cookie 不授予管理权限；管理 Cookie 也不能用于公共 OAuth 会话。

## 会话与安全边界

- 管理会话使用高熵随机令牌，服务端仅保存令牌摘要。新增独立的会话存储接口，并为 SQLite 和 PostgreSQL 增加迁移；多实例共享同一数据库时仍可验证和撤销会话。
- 管理 Cookie 与普通用户 Cookie 使用不同名称，限定 `/admin` 路径，设置 `HttpOnly` 和 `SameSite=Strict`；生产部署沿用现有 `session.secure` 要求设置 `Secure`。管理会话设 8 小时绝对有效期，不自动续期。
- 每次使用会话时都从持久化用户数据核对账号状态和 `admin` 角色，不依赖当前 60 秒的用户缓存。账号被禁用、删除或降级后，后续管理请求立即失效。存储故障时拒绝请求。
- 对使用 Cookie 认证的非安全方法要求 `X-Admin-CSRF` 请求头，令牌与当前管理会话绑定；API Key 请求不需要 CSRF 令牌。登录接口只接收 JSON，并校验同源请求来源。
- 登录复用已有密码比较，实现管理端专用的失败限流，记录登录成功、失败及退出事件；不记录密码、Cookie 或 CSRF 令牌。认证失败使用统一错误文案。
- 前端不再把管理员密码、API Key 或会话令牌存入 `localStorage` / `sessionStorage`。账号模式的登录状态由 `/admin/auth/me` 判定；写操作统一由 API 客户端附加 CSRF 请求头。登录页保留次要的「使用 API Key」入口以兼容尚未创建管理员的部署及外部认证策略，密钥只保存在当前页面内存中，刷新后需重新输入。

这些选择参照 [OWASP 会话管理建议](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[CSRF 防护建议](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)及[认证建议](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)。

## 代码边界

- `internal/ports/input/`：定义管理登录服务接口；`internal/ports/output/`：定义管理会话存储接口。
- `internal/services/`：处理密码验证、管理员角色检查、会话创建、查询和撤销。
- `internal/adapters/sqlite/`、`internal/adapters/postgres/` 与 `migrations/`：持久化管理会话。
- `api/admin/`：新增登录、当前账号、退出接口；组合 API Key 和管理员会话认证；对 Cookie 写请求校验 CSRF。
- `cmd/authserver/serve.go`：复用现有用户认证服务并完成依赖注入。
- `web/admin/src/`：将默认登录表单改为邮箱密码，刷新时恢复会话状态，退出时请求撤销会话。
- 文档：说明 CLI 创建首个管理员的步骤；新增接口后运行 `make docs-gen`，不手工修改生成的参考文档。

## 验收与测试

- 管理员账号能登录、刷新页面后保持登录、退出后立即失效；普通用户、禁用账号和错误密码均不能登录。
- 无凭据请求返回 `401`；无效 Bearer 不回退 Cookie；原有有效 API Key 仍能访问管理接口。
- Cookie 认证的写请求缺少或伪造 CSRF 令牌时拒绝，正确令牌可执行；API Key 调用保持兼容。
- 会话过期、撤销、账号禁用、角色降级和数据库故障均拒绝管理访问。
- 覆盖 SQLite 与 PostgreSQL 会话存储测试、管理 API 集成测试、前端测试，以及浏览器中的登录和退出流程。提交前执行项目要求的构建、测试、导入边界和文档生成检查。

## 本期不做

不新增自助注册、管理员角色分配页面、密码找回、MFA 或 OIDC 管理员单点登录。遗失管理员密码时，可用现有 CLI 新建管理员，再通过管理 API 禁用旧账号。现有管理操作审计若只记录静态 `admin` 标识，本期仅确保登录和退出事件可识别具体账号；逐项操作的完整个人归因另行设计。
