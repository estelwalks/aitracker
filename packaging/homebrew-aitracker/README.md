# AITracker Homebrew Tap

这是第一阶段的自有 Tap 目录，可直接复制到 GitHub 仓库
[`estelwalks/homebrew-aitracker`](https://github.com/estelwalks/homebrew-aitracker)。
`Casks/aitracker.rb` 和 `Casks/aitracker-beta.rb` 是没有伪造版本、URL 或
SHA-256 的模板；发布时必须用同一版本 Release 附件中的
`release-metadata.json` 生成并覆盖对应文件。

## 生成 Cask

在 AITracker 主仓库根目录运行：

```sh
node scripts/generate-homebrew-cask.mjs \
  --metadata release-metadata.json \
  --output packaging/homebrew-aitracker/Casks/aitracker.rb \
  --token aitracker \
  --channel stable

node scripts/generate-homebrew-cask.mjs \
  --metadata release-metadata.json \
  --output packaging/homebrew-aitracker/Casks/aitracker-beta.rb \
  --token aitracker-beta \
  --channel beta
```

生成器只读取 metadata 中的版本、频道、仓库、两个 Darwin DMG 的不可变
GitHub Release URL、SHA-256 和大小；它不会计算或复制本地文件 hash，也不会
把 metadata 中未使用的字段写进 Cask。Stable 与 beta 使用不同 token，不能
把 beta metadata 生成为稳定 Cask。

生成后，将 `packaging/homebrew-aitracker` 的内容复制到 Tap 仓库，审查差异，
再按 Tap 仓库的正常流程提交。生成器是幂等的，可重复运行以得到相同内容。

## 用户命令

```sh
brew tap estelwalks/aitracker

# 稳定频道（stable token）
brew install --cask estelwalks/aitracker/aitracker
brew upgrade --cask estelwalks/aitracker/aitracker

# beta 频道
brew install --cask estelwalks/aitracker/aitracker-beta
brew upgrade --cask estelwalks/aitracker/aitracker-beta
```

## 未签名 DMG 与 Gatekeeper

第一阶段不接入 Apple Developer ID、代码签名或 notarization，因此 macOS
Gatekeeper 可能显示“无法验证开发者”。用户应确认下载来源和 Release
校验值后，在系统设置的“隐私与安全性”中对该应用选择“仍要打开”，或在
Finder 中对应用右键选择“打开”。本 Tap 不要求、也不指导关闭 macOS 的全局
安全策略。

## 范围

本目录只维护 `estelwalks/aitracker` 自有 Tap。官方
`Homebrew/homebrew-cask` 不在第一阶段范围内；在官方 Cask 合并前，不应省略
Tap 前缀来宣传 `brew install --cask aitracker`。
