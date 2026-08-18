export const privacy = {
  local: {
    title: "全程本地执行",
    desc: "会话与 Skill 只留在这台机器，绝不上传",
  },
  ownership: {
    title: "成果不被劫持",
    desc: "蒸馏产物归你所有，不回流任何云端模型",
  },
  account: {
    title: "不登录 · 本地自登记",
    desc: "无需账号，设备本地生成身份标识",
  },
} as const;
