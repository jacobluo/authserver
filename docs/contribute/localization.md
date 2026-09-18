# UI localization in the fork

The admin console and the public OAuth pages have separate rendering stacks. Keep their translations separate so future upstream merges touch the smallest possible set of files. Both default to Simplified Chinese and offer English as an explicit choice. Never translate protocol identifiers, API response fields, client-provided names, resource slugs, or scope names.

## React admin console

- Put messages in matching `web/admin/src/locales/en/<namespace>.json` and `web/admin/src/locales/zh-CN/<namespace>.json` files. Use semantic keys, not English text as keys.
- Register each namespace once in `web/admin/src/i18n.ts`, then use `useTranslation("<namespace>")` in the page or shared component. Keep the JSX and business logic changes to the text-bearing lines; avoid formatting whole upstream files during translation updates.
- English is the fallback for missing keys. A visible language control changes the active language and stores only that preference under `authplane_language`; credentials are not stored there.
- Keep page headings, empty states, forms, validation, toasts, placeholders, tooltips, and accessibility labels in sync. Format dates and numbers with the active locale when adding new displays.
- `web/admin/dist/index.html` is the Go-embedded, single-file production build. Rebuild and commit it after changing admin UI sources.

## Public OAuth pages

The login, consent, OIDC error, and shared error pages are Go `html/template` surfaces. Their presentation text is selected through `api/shared/locale.go`. Existing English phrases are lookup keys in the Chinese table, which keeps upstream template diffs narrow. For new text, add a Chinese entry and render with `PageLocale.Text`; preserve `html/template` escaping. Language selection is presentation-only and must not change OAuth redirects, token JSON, status codes, CSRF validation, or protocol parameter names.

When upstream adds or changes a page, merge its behavior first, then add translations for the new visible text. A missing translation falls back to the English phrase, making omissions visible without breaking the flow.

## Verify after merging upstream

```bash
cd web/admin && npm test && npm run build
go test ./api/... -count=1
go test -tags integration ./api/public -count=1
git diff --check
```

Also open the admin login and navigation, switch to English and back, and exercise the public login and consent pages in both languages. Review the generated `web/admin/dist/index.html` diff before committing it.
