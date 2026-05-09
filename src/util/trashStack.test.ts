import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetTrashStackForTests,
  popTrashBatch,
  pushTrashBatch,
  trashStackSnapshot,
} from "./trashStack";

beforeEach(() => {
  _resetTrashStackForTests();
});

describe("trashStack", () => {
  it("pushes + pops in LIFO order", () => {
    pushTrashBatch(["/a"]);
    pushTrashBatch(["/b", "/c"]);
    expect(popTrashBatch()?.paths).toEqual(["/b", "/c"]);
    expect(popTrashBatch()?.paths).toEqual(["/a"]);
    expect(popTrashBatch()).toBeNull();
  });

  it("filters sftp:// paths out — they can't be undone via OS trash", () => {
    pushTrashBatch(["/local/x", "sftp://abc/y", "/local/z"]);
    expect(popTrashBatch()?.paths).toEqual(["/local/x", "/local/z"]);
  });

  it("skips a push when the batch contains only remotes", () => {
    pushTrashBatch(["sftp://abc/only"]);
    expect(popTrashBatch()).toBeNull();
  });

  it("caps the stack at 50 entries", () => {
    for (let i = 0; i < 60; i++) pushTrashBatch([`/x${i}`]);
    expect(trashStackSnapshot().length).toBe(50);
    expect(popTrashBatch()?.paths).toEqual(["/x59"]);
  });
});
