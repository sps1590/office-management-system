import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { holidaysBetween, leaveCalendar, onLeaveToday } from "@/lib/leave";
import { weekStartDay } from "@/lib/work-pattern";
import { monthWindow } from "@/lib/utils";
import { addUser, createTestTenant, type TestTenant } from "../helpers/world";

/*
   The leave calendar: a month of faces, and the short table of who is away
   today.

   The thing worth guarding here is the overlap test. A calendar built on
   `start_date BETWEEN from AND to` looks correct for every leave that begins
   inside the month and silently loses the ones that began before it — which
   are precisely the absences a planner looking at the 1st needs to see. Each
   case below is written against a fixed window so it reads the same whenever
   it runs.

   October 2026 is used throughout: 01 is a Thursday, and 02/03 are the Dhaka
   weekend.
*/

describe("the month window", () => {
  it("falls back when the parameter is missing or malformed", () => {
    for (const bad of [undefined, "", "2026-13", "2026-00", "nope", "2026-1", "../../etc"]) {
      expect(monthWindow(bad, "2026-11").month).toBe("2026-11");
    }
  });

  it("accepts a well-formed month and spans it exactly", () => {
    const w = monthWindow("2026-02", "2026-11");
    expect(w.from).toBe("2026-02-01");
    // 2026 is not a leap year; the last day is derived, not looked up.
    expect(w.to).toBe("2026-02-28");
  });

  it("finds the last day of a leap February", () => {
    expect(monthWindow("2028-02", "2026-11").to).toBe("2028-02-29");
  });

  it("carries the year when stepping across December and January", () => {
    expect(monthWindow("2026-12", "2026-11").later).toBe("2027-01");
    expect(monthWindow("2026-01", "2026-11").earlier).toBe("2025-12");
    expect(monthWindow("2026-12", "2026-11").to).toBe("2026-12-31");
  });
});

describe("where a calendar week starts", () => {
  it("begins on the company's first working day", () => {
    // Friday and Saturday off: the week starts on Sunday, and the weekend
    // lands at the end of the row where people look for it.
    expect(weekStartDay([5, 6])).toBe(0);
    // Saturday and Sunday off: Monday.
    expect(weekStartDay([6, 0])).toBe(1);
    // Friday only, as some Gulf companies run: Saturday.
    expect(weekStartDay([5])).toBe(6);
  });

  it("falls back to Sunday when the rest days are scattered", () => {
    // Tuesdays and Fridays off has two "first working days" and so no
    // single right answer.
    expect(weekStartDay([2, 5])).toBe(0);
    expect(weekStartDay([])).toBe(0);
    expect(weekStartDay(null)).toBe(0);
    expect(weekStartDay([0, 1, 2, 3, 4, 5, 6])).toBe(0);
  });
});

describe("the leave calendar", () => {
  let tenant: TestTenant;
  let other: TestTenant;
  let userId: string;
  let typeId: string;

  const FROM = "2026-10-01";
  const TO = "2026-10-31";

  const raise = async (
    t: TestTenant,
    user: string,
    type: string,
    start: string,
    end: string,
    status: string
  ) => {
    const db = await getDb();
    const rows = await db`
      INSERT INTO leave_requests
        (tenant_id, user_id, leave_type_id, start_date, end_date, days, status, reason)
      VALUES (${t.tenantId}, ${user}, ${type}, ${start}, ${end},
              ${1}, ${status}, 'Family wedding')
      RETURNING id
    `;
    return (rows[0] as { id: string }).id;
  };

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Calendar Co", timezone: "Asia/Dhaka" });
    other = await createTestTenant({ companyName: "Neighbour Co", timezone: "Asia/Dhaka" });
    userId = await addUser(tenant.tenantId, { roleKey: "employee", name: "Away Person" });
    const db = await getDb();
    const types = await db`
      SELECT id FROM leave_types WHERE tenant_id = ${tenant.tenantId} ORDER BY sort_order LIMIT 1
    `;
    typeId = (types[0] as { id: string }).id;
  });
  afterAll(async () => {
    await tenant.drop();
    await other.drop();
  });

  it("includes a leave that began before the window and runs into it", async () => {
    // Started 28 September, back on 5 October: absent for the first four days
    // of the month, and invisible to any query keyed on start_date alone.
    await raise(tenant, userId, typeId, "2026-09-28", "2026-10-04", "approved");
    const entries = await leaveCalendar(tenant.tenantId, FROM, TO);
    expect(entries.map((e) => e.start_date)).toContain("2026-09-28");
  });

  it("includes a leave that begins inside the window and runs past it", async () => {
    await raise(tenant, userId, typeId, "2026-10-29", "2026-11-06", "approved");
    const entries = await leaveCalendar(tenant.tenantId, FROM, TO);
    expect(entries.some((e) => e.end_date === "2026-11-06")).toBe(true);
  });

  it("excludes a leave that misses the window entirely", async () => {
    await raise(tenant, userId, typeId, "2026-12-01", "2026-12-03", "approved");
    const entries = await leaveCalendar(tenant.tenantId, FROM, TO);
    expect(entries.some((e) => e.start_date === "2026-12-01")).toBe(false);
  });

  it("shows pending requests alongside approved ones", async () => {
    await raise(tenant, userId, typeId, "2026-10-12", "2026-10-13", "pending");
    const entries = await leaveCalendar(tenant.tenantId, FROM, TO);
    const pending = entries.find((e) => e.start_date === "2026-10-12");
    // An approver has to be able to see the clash before deciding, not after.
    expect(pending?.status).toBe("pending");
  });

  it("leaves rejected and cancelled requests off the calendar", async () => {
    await raise(tenant, userId, typeId, "2026-10-20", "2026-10-21", "rejected");
    await raise(tenant, userId, typeId, "2026-10-22", "2026-10-23", "cancelled");
    const entries = await leaveCalendar(tenant.tenantId, FROM, TO);
    // Neither is an absence, and drawing a face on those days would have
    // somebody arranging cover for a person who is at their desk.
    expect(entries.some((e) => e.start_date === "2026-10-20")).toBe(false);
    expect(entries.some((e) => e.start_date === "2026-10-22")).toBe(false);
  });

  it("carries the face, the category colour and the department", async () => {
    const entries = await leaveCalendar(tenant.tenantId, FROM, TO);
    const e = entries[0];
    expect(e.full_name).toBe("Away Person");
    expect(e).toHaveProperty("avatar_url");
    expect(e.leave_type).toBeTruthy();
    // Everything the detail popover shows is joined on here, so clicking a
    // face costs no second round trip.
    expect(e.color).toMatch(/^#|^rgb/);
    expect(e).toHaveProperty("department");
    expect(e.reason).toBe("Family wedding");
  });

  it("never shows one company's absences on another's calendar", async () => {
    const theirs = await addUser(other.tenantId, { roleKey: "employee", name: "Not Yours" });
    const db = await getDb();
    const types = await db`
      SELECT id FROM leave_types WHERE tenant_id = ${other.tenantId} LIMIT 1
    `;
    await raise(other, theirs, (types[0] as { id: string }).id, "2026-10-15", "2026-10-16", "approved");

    const mine = await leaveCalendar(tenant.tenantId, FROM, TO);
    expect(mine.some((e) => e.full_name === "Not Yours")).toBe(false);
    const hers = await leaveCalendar(other.tenantId, FROM, TO);
    expect(hers.every((e) => e.full_name === "Not Yours")).toBe(true);
  });
});

describe("who is away today", () => {
  let tenant: TestTenant;
  let typeId: string;
  // A fixed day, so the window never drifts between the setup and the assert.
  const TODAY = "2026-10-15";

  const raise = async (user: string, start: string, end: string, status = "approved") => {
    const db = await getDb();
    await db`
      INSERT INTO leave_requests
        (tenant_id, user_id, leave_type_id, start_date, end_date, days, status)
      VALUES (${tenant.tenantId}, ${user}, ${typeId}, ${start}, ${end}, ${1}, ${status})
    `;
  };

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Today Co", timezone: "Asia/Dhaka" });
    const db = await getDb();
    const types = await db`
      SELECT id FROM leave_types WHERE tenant_id = ${tenant.tenantId} LIMIT 1
    `;
    typeId = (types[0] as { id: string }).id;

    const dept = await db`
      INSERT INTO departments (tenant_id, name, code) VALUES (${tenant.tenantId}, 'Operations', 'OPS')
      RETURNING id
    `;
    const inOps = await addUser(tenant.tenantId, { roleKey: "employee", name: "Ops Person" });
    await db`
      UPDATE users SET department_id = ${(dept[0] as { id: string }).id}
       WHERE id = ${inOps} AND tenant_id = ${tenant.tenantId}
    `;
    const noDept = await addUser(tenant.tenantId, { roleKey: "employee", name: "Floating Person" });

    // Spans today.
    await raise(inOps, "2026-10-14", "2026-10-16");
    // Starts today.
    await raise(noDept, TODAY, TODAY);
    // Ended yesterday, and starts tomorrow: neither is away today.
    await raise(inOps, "2026-10-10", "2026-10-14");
    await raise(noDept, "2026-10-16", "2026-10-18");
    // Approved only: a pending request is not yet somebody's absence.
    await raise(inOps, TODAY, TODAY, "pending");
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("counts only the leave that actually covers today", async () => {
    const rows = await onLeaveToday(tenant.tenantId, TODAY);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.start_date <= TODAY && r.end_date >= TODAY)).toBe(true);
  });

  it("names the department each absence is felt in", async () => {
    const rows = await onLeaveToday(tenant.tenantId, TODAY);
    expect(rows.find((r) => r.full_name === "Ops Person")?.department).toBe("Operations");
    // Nobody is dropped for having no department; the screen says so instead.
    expect(rows.find((r) => r.full_name === "Floating Person")?.department).toBeNull();
  });

  it("is empty on a day nobody booked", async () => {
    expect(await onLeaveToday(tenant.tenantId, "2026-10-30")).toHaveLength(0);
  });
});

describe("public holidays in the window", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Holiday Co", timezone: "Asia/Dhaka" });
    const db = await getDb();
    await db`
      INSERT INTO holidays (tenant_id, holiday_date, name) VALUES
        (${tenant.tenantId}, '2026-10-05', 'Inside'),
        (${tenant.tenantId}, '2026-09-30', 'Before'),
        (${tenant.tenantId}, '2026-11-01', 'After')
    `;
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("returns the days inside the window and no others", async () => {
    const days = await holidaysBetween(tenant.tenantId, "2026-10-01", "2026-10-31");
    expect(days.map((d) => d.name)).toEqual(["Inside"]);
    // A DATE stays a YYYY-MM-DD string from the driver to the screen; pushing
    // one through a zone is how 05 Oct becomes 04 Oct west of the server.
    expect(days[0].holiday_date).toBe("2026-10-05");
  });
});
