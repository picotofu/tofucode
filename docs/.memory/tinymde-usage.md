# TinyMDE Usage in Claude Code Web

## Important: mdMode Context

**`mdMode` ONLY affects the Files tab, NOT the chat input!**

### Chat View Input (ChatView.vue)
- **Always uses TinyMDE** - regardless of `mdMode` setting
- TinyMDE editor instance is always initialized for chat input
- Located in: `<div ref="editorEl" class="input tinyMDE">`
- Editor instance stored in: `editorInstance.value`
- Input value stored in: `inputValue.value`

**To update chat input programmatically:**
```javascript
// Update both the ref AND the TinyMDE instance
inputValue.value = newContent;
if (editorInstance.value) {
  editorInstance.value.setContent(newContent);
}
```

### Files Tab - File Editor (FileEditor.vue)
- Uses TinyMDE **only for markdown files** (.md)
- `mdMode` controls whether markdown formatting is enabled
- For non-markdown files, uses plain textarea
- Editor instance stored in: `tinyMdeInstance`

### Key Differences

| Feature | Chat Input | File Editor |
|---------|-----------|-------------|
| Always TinyMDE? | ✅ Yes | ❌ No (only .md files) |
| Affected by `mdMode`? | ❌ No | ✅ Yes |
| Editor ref | `editorInstance` | `tinyMdeInstance` |
| Container ref | `editorEl` | `mdEditorRef` |

## Common Mistakes to Avoid

❌ **Wrong**: Checking `mdMode` before updating chat input TinyMDE
```javascript
if (mdMode.value && editorInstance.value) {
  editorInstance.value.setContent(newContent); // WRONG!
}
```

✅ **Correct**: Always update TinyMDE if editor instance exists
```javascript
if (editorInstance.value) {
  editorInstance.value.setContent(newContent); // CORRECT!
}
```

## Related Features

- Tab key handling in File Editor markdown (FileEditor.vue)
- File reference button in FilePicker (FilePicker.vue)
- Reference handling from Files tab context menu (FileExplorer.vue)
