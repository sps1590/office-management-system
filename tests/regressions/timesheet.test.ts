import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { timesheet } from "@/lib/attendance";
import { shiftForUser } from "@/lib/shifts";
import { addUser, createTestTenant, type TestTenant } from "../helpers/world";

/*
   The timesheet, against a real database.

   Before it existed, "My attendance" listed only the days somebody checked
   in, so a month with four missed days looked exactly like a month with
   none. The whole point of this screen is the days with no row, which means
   the things worth pinning are: a rest day owes nothing, an absence owes a
   full day, approved leave owes nothing, and a day that has not happened yet
   is in neither column.

   October 2026 is used throughout, entirely in the past, so no day in the
   window is "scheduled" and the totals are stable whenever this runs.
   2026-10-01 is a Thursday; 02 Friday and 03 Saturday are the Dhaka weekend.
*/

const FROM = "2026-10-01";
const TO = "2026-10-31";

describe("the timesheet", () => {
  let tenant: TestTenant;
  let userId: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Timesheet Co", timezone: "Asia/Dhaka" });
    userId = await addUser(tenant.tenantId, { roleKey: "employee", name: "Sheet Subject" });
  });
  afterAll(async () => {
    await tenant.drop();
  });

  const sheet = async () => {
    const settings = await getSettings(tenant.tenantId);
    const shift = await shiftForUser(tenant.tenantId, userId);
    return timesheet(tenant.tenantId, userId, FROM, TO, settings, shift, "Asia/Dhaka");
  };

  const dayOf = async (date: string) => (await sheet()).days.find((d) => d.date === date)!;

  it("covers every calendar day in the window, not just the days with a record", async () => {
    const s = await sheet();
    expect(s.days).toHaveLength(31);
    expect(s.days[0].date).toBe(FROM);
    expect(s.days[30].date).toBe(TO);
  });

  it("expects nothing on the company's rest days", async () => {
    // Friday and Saturday, the default weekend_days of [5, 6].
    const friday = await dayOf("2026-10-02");
    expect(friday.status).toBe("rest_day");
    expect(friday.expectedMinutes).toBe(0);
    expect((await dayOf("2026-10-03")).status).toBe("rest_day");
  });

  it("expects a full day on a working day and calls a missing one absent", async () => {
    const thursday = await dayOf("2026-10-01");
    expect(thursday.working).toBe(true);
    expect(thursday.expectedMinutes).toBe(480);
    // No attendance row and the day is in the past: that is an absence, and
    // it is exactly what the old screen could not show.
    expect(thursday.status).toBe("absent");
  });

  it("counts rest days out of the shortfall", async () => {
    const s = await sheet();
    // October 2026 has five Fridays and five Saturdays, leaving 21 working days.
    expect(s.totals.restDays).toBe(10);
    expect(s.totals.workingDays).toBe(21);
    expect(s.totals.expectedMinutes).toBe(21 * 480);
  });

  it("subtracts worked time from the expected total", async () => {
    const db = await getDb();
    await db`
      INSERT INTO attendance_records
        (tenant_id, user_id, work_date, worked_minutes, overtime_minutes, late_minutes, status)
      VALUES (${tenant.tenantId}, ${userId}, '2026-10-05', 500, 20, 12, 'late')
    `;
    const s = await sheet();
    const monday = s.days.find((d) => d.date === "2026-10-05")!;
    expect(monday.workedMinutes).toBe(500);
    expect(monday.lateMinutes).toBe(12);
    expect(monday.status).toBe("late");
    expect(s.totals.workedMinutes).toBe(500);
    expect(s.totals.overtimeMinutes).toBe(20);
    expect(s.totals.balanceMinutes).toBe(500 - 21 * 480);
  });

  it("owes nothing for a day on approved leave", async () => {
    const db = await getDb();
    const types = await db`
      SELECT id FROM leave_types WHERE tenant_id = ${tenant.tenantId} LIMIT 1
    `;
    await db`
      INSERT INTO leave_requests
        (tenant_id, user_id, leave_type_id, start_date, end_date, days, status)
      VALUES (${tenant.tenantId}, ${userId}, ${(types[0] as { id: string }).id},
              '2026-10-07', '2026-10-08', 2, 'approved')
    `;
    const s = await sheet();
    const onLeave = s.days.find((d) => d.date === "2026-10-07")!;
    expect(onLeave.status).toBe("on_leave");
    expect(onLeave.leaveType).toBeTruthy();
    // The leave balance has already paid for the day, so the timesheet must
    // not bill it a second time as a shortfall.
    expect(onLeave.expectedMinutes).toBe(0);
    expect(s.totals.leaveDays).toBe(2);
    // Two of the 21 working days are now paid for by the leave balance.
    expect(s.totals.expectedMinutes).toBe(19 * 480);
  });

  it("expands a leave range across every day it covers", async () => {
    const s = await sheet();
    expect(s.days.find((d) => d.date === "2026-10-08")!.status).toBe("on_leave");
    expect(s.days.find((d) => d.date === "2026-10-09")!.status).not.toBe("on_leave");
  });

  it("owes nothing on a public holiday", async () => {
    const db = await getDb();
    await db`
      INSERT INTO holidays (tenant_id, holiday_date, name)
      VALUES (${tenant.tenantId}, '2026-10-12', 'Test Holiday')
    `;
    const day = await dayOf("2026-10-12");
    expect(day.status).toBe("holiday");
    expect(day.holidayName).toBe("Test Holiday");
    expect(day.expectedMinutes).toBe(0);
    expect(day.working).toBe(false);
  });

  it("leaves days that have not happened out of the totals", async () => {
    const settings = await getSettings(tenant.tenantId);
    // A window a decade out: every working day in it is scheduled, and a
    // timesheet that counted them would show a year's shortfall on the 1st.
    const future = await timesheet(
      tenant.tenantId,
      userId,
      "2036-03-01",
      "2036-03-31",
      settings,
      null,
      "Asia/Dhaka"
    );
    expect(future.days).toHaveLength(31);
    expect(future.days.some((d) => d.status === "scheduled")).toBe(true);
    expect(future.totals.expectedMinutes).toBe(0);
    expect(future.totals.absentDays).toBe(0);
    expect(future.totals.balanceMinutes).toBe(0);
  });

  it("follows the person's shift instead of the company week once assigned", async () => {
    const db = await getDb();
    const made = await db`
      INSERT INTO shifts (tenant_id, name, start_time, end_time, break_minutes, work_days)
      VALUES (${tenant.tenantId}, 'Weekend Crew', '22:00', '06:00', 0, ARRAY[5,6])
      RETURNING id
    `;
    await db`
      UPDATE users SET shift_id = ${(made[0] as { id: string }).id}
       WHERE id = ${userId} AND tenant_id = ${tenant.tenantId}
    `;

    const s = await sheet();
    expect(s.shiftName).toBe("Weekend Crew");
    // Friday is now a working day and Thursday is not: the shift overrides
    // the company's weekend for the people on it.
    expect(s.days.find((d) => d.date === "2026-10-02")!.working).toBe(true);
    expect(s.days.find((d) => d.date === "2026-10-01")!.status).toBe("rest_day");
    // 22:00 to 06:00 is eight hours, not minus sixteen.
    expect(s.days.find((d) => d.date === "2026-10-02")!.expectedMinutes).toBe(480);
  });

  it("keeps one person's timesheet out of another's", async () => {
    const other = await addUser(tenant.tenantId, { roleKey: "employee", name: "Somebody Else" });
    const settings = await getSettings(tenant.tenantId);
    const theirs = await timesheet(
      tenant.tenantId,
      other,
      FROM,
      TO,
      settings,
      null,
      "Asia/Dhaka"
    );
    // The 500 worked minutes and the approved leave belong to the first user.
    expect(theirs.totals.workedMinutes).toBe(0);
    expect(theirs.totals.leaveDays).toBe(0);
  });
});
