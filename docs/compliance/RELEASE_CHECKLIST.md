# 开源发布核对表

## 代码与许可

- [ ] `npm run lint` 通过
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] `npm run build:electron` 通过
- [ ] 依赖许可证无 GPL/AGPL 等未批准条款
- [ ] Clean Room 相似度报告已归档

## 隐私与安全

- [ ] 缓存不包含 prompt、content、message 等正文
- [ ] 本地服务不监听公网地址
- [ ] Electron 启用上下文隔离并关闭 Node 集成
- [ ] 文件删除仅进入 TrustTools 回收站且校验路径
- [ ] 安全规则测试覆盖危险命令、恶意 URL 和密钥

## 交付

- [ ] macOS DMG 安装、启动、托盘、自启测试通过
- [ ] Windows NSIS 安装、启动、托盘、自启测试通过
- [ ] 首次启动两分钟内展示本地数据
- [ ] 离线状态下本地功能可用
- [ ] 中文界面和中文错误提示检查通过
