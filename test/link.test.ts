import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockers, LINK_TARGETS, planLinks } from "../src/link-plan.ts";

const target = (appKey: string) => LINK_TARGETS.find((t) => t.appKey === appKey)!;

test("empty rows are linked, rows already holding the same identity are left alone", () => {
  const plan = planLinks(
    target("booking"),
    [
      { appUserId: "a", identityId: "id-1" },
      { appUserId: "b", identityId: "id-2" },
    ],
    [
      { appUserId: "a", identityId: null },
      { appUserId: "b", identityId: "id-2" },
      { appUserId: "c", identityId: null },
    ],
  );
  assert.deepEqual(plan.toLink, [{ appUserId: "a", identityId: "id-1" }]);
  assert.equal(plan.alreadyLinked, 1);
  assert.deepEqual(blockers(plan), []);
});

test("a row holding a different identity is never overwritten and blocks the app", () => {
  const plan = planLinks(target("sponsor"), [{ appUserId: "a", identityId: "id-1" }], [{ appUserId: "a", identityId: "id-9" }]);
  assert.equal(plan.toLink.length, 0);
  assert.deepEqual(plan.mismatched, [{ appUserId: "a", current: "id-9", expected: "id-1" }]);
  assert.equal(blockers(plan).length, 1);
});

test("a linked row the identity database does not know about blocks the app", () => {
  const plan = planLinks(target("predictit"), [], [{ appUserId: "z", identityId: "id-5" }]);
  assert.equal(plan.unknownLinks.length, 1);
  assert.equal(blockers(plan).length, 1);
});

test("memberships whose app row is gone are reported, not fatal", () => {
  const plan = planLinks(target("turfit"), [{ appUserId: "gone", identityId: "id-1" }], []);
  assert.deepEqual(plan.missingInApp, ["gone"]);
  assert.deepEqual(blockers(plan), []);
});

test("Score admins are skipped because si_admin has no identity column", () => {
  const plan = planLinks(
    target("score"),
    [
      { appUserId: "admin:3", identityId: "id-1" },
      { appUserId: "7", identityId: "id-1" },
    ],
    [{ appUserId: "7", identityId: null }],
  );
  assert.deepEqual(plan.skipped, ["admin:3"]);
  assert.deepEqual(plan.missingInApp, []);
  assert.equal(plan.toLink.length, 1);
});

test("each target's migration file adds exactly the column the linker writes", () => {
  for (const t of LINK_TARGETS) {
    const sql = readFileSync(new URL(`../sql/apps/${t.migration}`, import.meta.url), "utf8");
    assert.match(sql, new RegExp(`ALTER TABLE ${t.table.replace(/"/g, '\\"')} ADD COLUMN IF NOT EXISTS ${t.identityColumn.replace(/"/g, '\\"')} uuid`));
  }
});
