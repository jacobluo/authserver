package shared

import (
	"net/http"
	"net/url"
)

const localeCookieName = "authplane_lang"

// PageLocale is presentation-only state. Its zero value is Simplified Chinese;
// OAuth wire values, identifiers, and client-supplied names are never translated.
type PageLocale struct {
	code      string
	switchURL string
}

func (l PageLocale) Code() string {
	if l.code == "en" {
		return "en"
	}
	return "zh-CN"
}

func (l PageLocale) SwitchURL() string { return l.switchURL }

// Link carries an explicit English choice to the next internal browser page.
// Chinese is the default, so it needs no parameter.
func (l PageLocale) Link(rawURL string) string {
	if l.Code() != "en" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := u.Query()
	q.Set("lang", "en")
	u.RawQuery = q.Encode()
	return u.String()
}

func (l PageLocale) SwitchLabel() string {
	if l.Code() == "en" {
		return "简体中文"
	}
	return "English"
}

func (l PageLocale) Text(english string) string {
	if l.Code() == "en" {
		return english
	}
	if translated, ok := chinesePageText[english]; ok {
		return translated
	}
	return english
}

// PageLocaleForRequest reads an explicit language choice before the preference
// cookie. A form may carry lang after ParseForm; this function does not parse
// the body itself, preserving handler body limits and validation ordering.
func PageLocaleForRequest(w http.ResponseWriter, r *http.Request) PageLocale {
	choice := r.URL.Query().Get("lang")
	if choice == "" && r.PostForm != nil {
		choice = r.PostForm.Get("lang")
	}
	code := "zh-CN"
	if c, err := r.Cookie(localeCookieName); err == nil && (c.Value == "en" || c.Value == "zh-CN") {
		code = c.Value
	}
	if choice == "en" || choice == "zh-CN" {
		code = choice
		if w != nil {
			http.SetCookie(w, &http.Cookie{
				Name: localeCookieName, Value: code, Path: "/", MaxAge: 365 * 24 * 60 * 60,
				HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil,
			})
		}
	}
	u := *r.URL
	query := u.Query()
	// A form error is rendered after POST. Keep only the navigation context
	// needed to revisit the corresponding GET page when switching languages;
	// never copy credentials, CSRF tokens, or consent decisions into a URL.
	if r.PostForm != nil {
		for _, key := range []string{"redirect", "session_id"} {
			if query.Get(key) == "" && r.PostForm.Get(key) != "" {
				query.Set(key, r.PostForm.Get(key))
			}
		}
	}
	if code == "en" {
		query.Set("lang", "zh-CN")
	} else {
		query.Set("lang", "en")
	}
	u.RawQuery = query.Encode()
	u.Fragment = ""
	return PageLocale{code: code, switchURL: relativePageURL(&u)}
}

func relativePageURL(u *url.URL) string {
	// RequestURI deliberately omits any Host or scheme supplied on a request.
	return u.RequestURI()
}

// The keys are the existing English presentation strings, keeping the page
// templates and handler error contracts single-sourced and easy to merge.
var chinesePageText = map[string]string{
	"Sign In": "登录", "Welcome back": "欢迎回来", "Sign in to your account to continue": "登录账户以继续",
	"Continue with": "使用", "or": "或", "Email address": "电子邮箱", "Password": "密码",
	"Enter your password": "请输入密码", "Sign in": "登录", "Secured by Authplane": "由 Authplane 提供安全保护",
	"Invalid form data": "表单数据无效", "Invalid request. Please try again.": "请求无效，请重试。",
	"Invalid email or password": "邮箱或密码错误", "Too many failed attempts. Please try again later.": "失败次数过多，请稍后重试。",
	"Authorize": "授权", "wants permission to access": "请求访问", "Authorize access": "授权访问",
	"wants to access your account": "请求访问您的账户", "Permissions requested": "请求的权限",
	"Remember this decision": "记住此决定", "Approving will send your authorization to": "同意后，授权信息将发送至",
	"This address is your own computer. Any program running on it can ask for this — including one you did not intend to authorize. Continue only if you started this yourself, just now.": "此地址是您自己的电脑。任何在其上运行的程序都可能发起此请求，包括您无意授权的程序。请仅在您刚刚主动发起此操作时继续。",
	"Deny": "拒绝", "Allow access": "允许访问",
	"Authentication Error": "身份验证错误", "Authentication failed": "身份验证失败",
	"Authentication failed. Please try again.":                    "身份验证失败，请重试。",
	"Sign-in is temporarily unavailable. Please try again later.": "登录暂时不可用，请稍后重试。",
	"Missing authorization code or state.":                        "缺少授权码或状态参数。",
	"Invalid or expired state. Please try again.":                 "状态无效或已过期，请重试。",
	"Back to sign in": "返回登录",
	"Invalid Client":  "无效的客户端", "The client_id is not recognized.": "无法识别 client_id。",
	"Invalid Redirect URI": "无效的重定向 URI", "The redirect_uri does not match the client registration.": "redirect_uri 与客户端注册信息不匹配。",
	"Client Suspended": "客户端已停用", "This client has been suspended.": "此客户端已被停用。",
	"Authorization Error": "授权错误", "The requested grant type or response type is not supported.": "不支持请求的授权类型或响应类型。",
	"Invalid Resource": "无效的资源", "Consent is only available for MCP resources, not upstream broker resources.": "仅 MCP 资源支持授权确认，上游代理资源不支持。",
	"Unknown Resource": "未知资源", "The requested resource is not registered with this authorization server.": "请求的资源未在此授权服务器注册。",
	"Ambiguous Resource": "资源不明确", "The resource identifier matches more than one resource. Use the resource slug to disambiguate.": "资源标识符匹配多个资源，请使用资源短名称加以区分。",
	"Missing Session": "缺少会话", "No session_id provided.": "未提供 session_id。",
	"Invalid Session": "无效的会话", "The authorization session is invalid or expired.": "授权会话无效或已过期。",
	"Internal Error": "内部错误", "Could not render the consent page. Please try again.": "无法显示授权确认页面，请重试。",
	"Invalid Form": "无效的表单", "Could not parse form data.": "无法解析表单数据。",
	"Not Authenticated": "尚未登录", "Please log in first.": "请先登录。",
	"Invalid Request": "无效的请求", "CSRF validation failed. Please try again.": "请求安全验证失败，请重试。",
	"Could not validate the request. Please try again.": "无法验证请求，请重试。",
	"Access Denied": "访问已拒绝", "You denied access to the application.": "您已拒绝此应用的访问请求。",
	"No Permissions Selected": "未选择权限", "You must approve at least one permission to continue. Use the Deny button if you do not want to grant access.": "请至少同意一项权限才能继续。如果不希望授权，请点击“拒绝”。",
	"Error": "错误", "The authorization server could not resolve its issuer.": "授权服务器无法确定其签发者。",
	"The authorization server is misconfigured.":         "授权服务器配置有误。",
	"The authorization server has no issuer configured.": "授权服务器未配置签发者。",
	"Consent Error": "授权确认错误", "Failed to process consent. The session may have expired.": "无法处理授权确认，会话可能已过期。",
	"Invalid redirect URI": "无效的重定向 URI",
	"Bad Request":          "错误的请求", "Missing code or state parameter.": "缺少 code 或 state 参数。",
	"Forbidden": "禁止访问", "No active session. Please log in and try again.": "当前没有有效会话，请登录后重试。",
	"Invalid State": "无效的状态", "The connect request has expired or was already used. Please try again.": "连接请求已过期或已使用，请重试。",
	"The state parameter is invalid or tampered with.":     "state 参数无效或已被篡改。",
	"This connect request belongs to a different user.":    "此连接请求属于其他用户。",
	"Failed to complete the connection. Please try again.": "无法完成连接，请重试。",
}
