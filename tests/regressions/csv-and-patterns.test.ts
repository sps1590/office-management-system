import { describe, expect, it } from "vitest";
import { normaliseHeader, parseCsv, rowsToObjects, toCsv } from "@/lib/csv";
import {
  crossesMidnight,
  expectedForDay,
  graceFor,
  minutesOfDay,
  shiftMinutes,
  workDaysLabel,
} from "@/lib/work-pattern";
import type { TenantSettings } from "@/lib/types";

/*
   The two pure halves of the import-and-shift work: the CSV codec that
   everything a person uploads passes through, and the arithmetic that decides
   what their timesheet expects of them. Neither needs a database, so these
   run in milliseconds and are the right place to pin the edge cases — the
   midnight-crossing shift, the quoted comma, the blank cell that must not be
   read as a zero.
*/

describe("the CSV codec", () => {
  it("round-trips a value containing a comma, a quote and a newline", () => {
    const nasty = 'Hossain, Md. "Jaker"\nLine two';
    const rows = parseCsv(toCsv(["name"], [[nasty]]));
    expect(rows[1][0]).toBe(nasty);
  });

  it("writes the byte-order mark Excel needs, and strips it on the way back", () => {
    const csv = toCsv(["name"], [["রহিম"]]);
    // Without this Excel on Windows reads the file as the system codepage and
    // every Bengali name arrives as mojibake.
    expect(csv.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv)[1][0]).toBe("রহিম");
  });

  it("uses CRLF, which is what Excel writes back", () => {
    expect(toCsv(["a", "b"], [[1, 2]])).toContain("\r\n");
  });

  it("quotes a field with leading or trailing spaces so they survive", () => {
    expect(parseCsv(toCsv(["n"], [["  padded  "]]))[1][0]).toBe("  padded  ");
  });

  it("accepts LF, CRLF and a trailing newline alike", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops the blank rows a spreadsheet leaves behind", () => {
    // Excel very often writes a run of empty rows under the data.
    expect(parseCsv("a,b\n1,2\n,\n\n,\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps an empty cell distinct from a missing row", () => {
    const rows = parseCsv("a,b,c\n1,,3\n");
    expect(rows[1]).toEqual(["1", "", "3"]);
  });

  it("matches a header however Excel capitalised it", () => {
    for (const h of ["full_name", "Full Name", "FULL NAME", "full_name*", "Full-Name"]) {
      expect(normaliseHeader(h)).toBe("fullname");
    }
  });

  it("keys rows by normalised header and trims the values", () => {
    const objects = rowsToObjects(parseCsv('Full Name*,Email\n Jaker , A@B.COM \n'));
    expect(objects).toEqual([{ fullname: "Jaker", email: "A@B.COM" }]);
  });
});

const settings = {
  standard_work_minutes: 480,
  work_start_time: "09:00:00",
  grace_minutes: 15,
  weekend_days: [5, 6],
} as TenantSettings;

const dayShift = {
  id: "s1",
  name: "Day",
  start_time: "09:00:00",
  end_time: "17:00:00",
  break_minutes: 60,
  work_days: [0, 1, 2, 3, 4],
  grace_minutes: null,
  is_active: true,
};

describe("shift arithmetic", () => {
  it("reads a clock time as minutes past midnight", () => {
    expect(minutesOfDay("09:30:00")).toBe(570);
    expect(minutesOfDay("00:00")).toBe(0);
  });

  it("takes the unpaid break off the span", () => {
    expect(shiftMinutes(dayShift)).toBe(7 * 60);
  });

  it("counts a shift that crosses midnight as eight hours, not minus sixteen", () => {
    const night = { start_time: "22:00:00", end_time: "06:00:00", break_minutes: 0 };
    expect(crossesMidnight(night)).toBe(true);
    expect(shiftMinutes(night)).toBe(8 * 60);
  });

  it("treats a shift ending exactly at its start as a full day round", () => {
    expect(shiftMinutes({ start_time: "09:00", end_time: "09:00", break_minutes: 0 })).toBe(1440);
  });

  it("never returns a negative day when the break is longer than the shift", () => {
    expect(shiftMinutes({ start_time: "09:00", end_time: "10:00", break_minutes: 120 })).toBe(0);
  });

  it("names consecutive days as a range and scattered ones as a list", () => {
    expect(workDaysLabel([0, 1, 2, 3, 4])).toBe("Sun–Thu");
    expect(workDaysLabel([0, 2, 4])).toBe("Sun, Tue, Thu");
    expect(workDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(workDaysLabel([])).toBe("No working days");
  });

  it("prefers the shift's own grace period, falling back to the company's", () => {
    expect(graceFor(dayShift, settings)).toBe(15);
    expect(graceFor({ ...dayShift, grace_minutes: 0 }, settings)).toBe(0);
    expect(graceFor(null, settings)).toBe(15);
  });
});

describe("what a day expects", () => {
  // 2026-11-05 is a Thursday, 06 a Friday, 08 a Sunday.
  it("expects the standard day on a company working day", () => {
    expect(expectedForDay("2026-11-05", null, settings)).toMatchObject({
      working: true,
      minutes: 480,
    });
  });

  it("expects nothing on a company rest day", () => {
    // Friday is in weekend_days, so no hours are owed and the timesheet shows
    // no shortfall for it.
    expect(expectedForDay("2026-11-06", null, settings)).toMatchObject({
      working: false,
      minutes: 0,
    });
  });

  it("lets a shift override the company's rest days", () => {
    const fridayShift = { ...dayShift, work_days: [5, 6] };
    expect(expectedForDay("2026-11-06", fridayShift, settings).working).toBe(true);
    expect(expectedForDay("2026-11-05", fridayShift, settings).working).toBe(false);
  });

  it("reads the weekday from the calendar, not from a time zone", () => {
    // The same date must be the same weekday wherever the company is; pushing
    // a DATE through a zone is how a Friday becomes a Thursday.
    expect(expectedForDay("2026-11-06", null, settings).working).toBe(false);
    expect(expectedForDay("2026-11-08", null, settings).working).toBe(true);
  });
});
