import { mkdir, rename, cp, rm } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BackupReceipt,
  FileSystemPort,
  StagingReceipt,
  TargetCapability,
  TargetRef,
} from "../contracts.ts";
import type { PackageRef } from "../../skill-catalog/contracts.ts";

/** Server-only target mapping. The renderer receives only TargetRef values. */
export interface ServerSkillTarget {
  readonly targetRef: TargetRef;
  readonly agentId: string;
  readonly platform: TargetCapability["platform"];
  readonly root: string;
  readonly skills: TargetCapability["skills"];
}

export interface CreateFileSystemPortOptions {
  readonly targets: readonly ServerSkillTarget[];
  readonly packageRoots?: ReadonlyMap<PackageRef, string>;
  readonly allowedRoots?: readonly string[];
}

function assertInside(path: string, roots: readonly string[]): void {
  const absolute = resolve(path);
  if (
    !roots.some((root) => {
      const rel = relative(resolve(root), absolute);
      return (
        rel === "" ||
        (!rel.startsWith("..") && !rel.includes(`${requireSeparator()}`))
      );
    })
  )
    throw new Error("target outside allowed root");
}

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function targetDirectory(target: ServerSkillTarget): string {
  return join(target.root, ".trusttools", "skills");
}

/** Controlled adapter: every external path is resolved from a server-owned target map. */
export function createNodeSkillFileSystemPort(
  options: CreateFileSystemPortOptions,
): FileSystemPort {
  const targetFor = (ref: TargetRef) => {
    const target = options.targets.find((item) => item.targetRef === ref);
    if (!target) throw new Error("unknown target");
    assertInside(target.root, options.allowedRoots ?? [target.root]);
    return target;
  };
  return {
    async inspect(targetRef) {
      const target = targetFor(targetRef);
      return {
        targetRef,
        agentId: target.agentId,
        platform: target.platform,
        support: "supported",
        skills: target.skills,
        installedSkills: [],
      };
    },
    async stage(input) {
      const target = targetFor(input.targetRef);
      const source = options.packageRoots?.get(input.packageRef);
      if (!source) throw new Error("package source unavailable");
      assertInside(source, options.allowedRoots ?? [source]);
      const stagingRef =
        `staging:${randomUUID()}` as StagingReceipt["stagingRef"];
      const stagingPath = join(
        targetDirectory(target),
        ".staging",
        stagingRef.slice("staging:".length),
      );
      await mkdir(dirname(stagingPath), { recursive: true, mode: 0o700 });
      await cp(source, stagingPath, { recursive: true, force: false });
      return {
        stagingRef,
        targetRef: input.targetRef,
        packageRef: input.packageRef,
        packageHash: input.packageHash,
      };
    },
    async backup(input): Promise<BackupReceipt> {
      const target = targetFor(input.targetRef);
      const skillPath = join(
        targetDirectory(target),
        input.skillRef.slice("skill:".length),
      );
      assertInside(skillPath, options.allowedRoots ?? [target.root]);
      const backupRef = `backup:${randomUUID()}` as BackupReceipt["backupRef"];
      const backupPath = join(
        targetDirectory(target),
        ".backups",
        backupRef.slice("backup:".length),
      );
      try {
        await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
        await rename(skillPath, backupPath);
        return {
          backupRef,
          targetRef: input.targetRef,
          skillRef: input.skillRef,
          existed: true,
        };
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
        return {
          backupRef,
          targetRef: input.targetRef,
          skillRef: input.skillRef,
          existed: false,
        };
      }
    },
    async replace(input) {
      const target = targetFor(input.targetRef);
      const source = join(
        targetDirectory(target),
        ".staging",
        input.staging.stagingRef.slice("staging:".length),
      );
      const destination = join(
        targetDirectory(target),
        input.skillRef.slice("skill:".length),
      );
      assertInside(source, options.allowedRoots ?? [target.root]);
      assertInside(destination, options.allowedRoots ?? [target.root]);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await rename(source, destination);
    },
    async restore(input) {
      const target = targetFor(input.targetRef);
      if (!input.backup.existed) return;
      const source = join(
        targetDirectory(target),
        ".backups",
        input.backup.backupRef.slice("backup:".length),
      );
      const destination = join(
        targetDirectory(target),
        input.skillRef.slice("skill:".length),
      );
      assertInside(source, options.allowedRoots ?? [target.root]);
      assertInside(destination, options.allowedRoots ?? [target.root]);
      await rm(destination, { recursive: true, force: true });
      await rename(source, destination);
    },
    async remove(input) {
      const target = targetFor(input.targetRef);
      const skillPath = join(
        targetDirectory(target),
        input.skillRef.slice("skill:".length),
      );
      assertInside(skillPath, options.allowedRoots ?? [target.root]);
      const backupRef = `backup:${randomUUID()}` as BackupReceipt["backupRef"];
      const backupPath = join(
        targetDirectory(target),
        ".backups",
        backupRef.slice("backup:".length),
      );
      try {
        await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
        await rename(skillPath, backupPath);
        return {
          backupRef,
          targetRef: input.targetRef,
          skillRef: input.skillRef,
          existed: true,
        };
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
        return {
          backupRef,
          targetRef: input.targetRef,
          skillRef: input.skillRef,
          existed: false,
        };
      }
    },
  };
}
