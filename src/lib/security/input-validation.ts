import type { SecurityInputFile } from "./scanner.ts";
import { AppError } from "../errors";

export const MAX_SKILL_FILE_SIZE = 100 * 1024 * 1024;

export interface LocalSkillFile extends SecurityInputFile {
  targetName: string;
}

type BrowserFile = Pick<File, "name" | "size" | "text"> & {
  webkitRelativePath?: string;
};

function isSkillFileName(name: string): boolean {
  return name.toLocaleLowerCase() === "skill.md";
}

/**
 * 在读取内容及消耗每日额度之前确认输入范围。
 * 单文件必须为 SKILL.md；目录输入必须包含 SKILL.md，且只返回该文件。
 */
export async function readLocalSkillFile(
  supplied: FileList | BrowserFile[],
): Promise<LocalSkillFile> {
  const files = Array.from(supplied as ArrayLike<BrowserFile>);
  if (files.length === 0) throw new AppError("errors.security.fileRequired");

  const hasDirectoryPath = files.some((file) =>
    Boolean(file.webkitRelativePath),
  );
  if (!hasDirectoryPath && files.length !== 1) {
    throw new AppError("errors.security.fileTypeInvalid");
  }

  const skillFile = files.find((file) => isSkillFileName(file.name));
  if (!skillFile) {
    throw new AppError("errors.security.fileTypeInvalid");
  }
  if (!hasDirectoryPath && !isSkillFileName(skillFile.name)) {
    throw new AppError("errors.security.fileTypeInvalid");
  }
  if (skillFile.size > MAX_SKILL_FILE_SIZE) {
    throw new AppError("errors.security.fileTooLarge");
  }

  const content = await skillFile.text();
  if (content.includes("\0")) throw new AppError("errors.security.notTextFile");
  const root = skillFile.webkitRelativePath?.split("/")[0];
  return {
    name: skillFile.webkitRelativePath || skillFile.name,
    content,
    targetName: root ? `${root}/` : skillFile.name,
  };
}
