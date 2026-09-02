# 桌宠角色包目录

把每只桌宠作为一个独立文件夹放在这里：

```text
resources/characters/
└─ 角色文件夹名/
   ├─ pet.json
   └─ spritesheet.webp
```

兼容 Desktop-pet / Hatch-Pet 的基础配置：

```json
{
  "id": "demo-pet",
  "displayName": "Demo 桌宠",
  "description": "桌宠简介",
  "spritesheetPath": "spritesheet.webp"
}
```

当前扫描器会读取 WebP 编码、尺寸、文件大小，并检查参考图集规格
`1536 × 1872 / 8 列 × 9 行 / 单帧 192 × 208`。将 demo 包放入后，
可以在控制台“桌宠管理”页点击“重新扫描”。

标准图集会自动映射待机、招呼、拖动、思考、回答、休息和错误动作；如需覆盖
帧率或行号，可在 `pet.json.behavior` 中填写 `fps`、`idleRows`、
`draggingRow`、`thinkingRow`、`talkingRow` 等字段。

安全限制：`pet.json` 最大 256 KB，WebP 最大 64 MB；`spritesheetPath`
只能填写当前角色目录中的 `.webp` 文件名，不接受绝对路径、子目录或符号链接。
