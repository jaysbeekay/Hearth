"use client";

import { useState } from "react";
import { Field } from "@/components/FormField";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import {
  WEEKDAYS,
  cronTimeOfDay,
  formatScheduleTime,
  parseSchedule,
  parseScheduleTime,
  scheduleToCron,
  type ScheduleKind,
} from "@/lib/cronSchedule";

// #363 — "Daily at 08:00" / "Weekly on Monday" instead of a raw cron
// string. The cron string the server stores is a hidden input named `name`;
// "Advanced (cron)" shows it as a text field for anything else.
export function SchedulePicker({
  id,
  name,
  label,
  defaultCron,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  defaultCron: string;
  hint?: string;
}) {
  const initial = parseSchedule(defaultCron);
  const [kind, setKind] = useState<ScheduleKind>(initial.kind);
  const [day, setDay] = useState(initial.kind === "weekly" ? initial.day : 1);
  const [time, setTime] = useState(
    initial.kind === "advanced" ? "08:00" : formatScheduleTime(initial.hour, initial.minute),
  );
  const [cron, setCron] = useState(defaultCron);

  const parsedTime = parseScheduleTime(time) ?? { hour: 8, minute: 0 };
  const value =
    kind === "advanced"
      ? cron
      : scheduleToCron(kind === "daily" ? { kind, ...parsedTime } : { kind, day, ...parsedTime });

  function changeKind(next: ScheduleKind) {
    // Switching to Advanced starts from what the simple choice stood for.
    if (next === "advanced" && kind !== "advanced") setCron(value);
    // And back again keeps what the cron said, when it's a simple schedule.
    if (next !== "advanced" && kind === "advanced") {
      // A compound cron ("0 6 * * 1,3,5") can't be shown as one simple
      // choice, but its time of day (and first weekday) still carry over.
      const parsed = cronTimeOfDay(cron);
      if (parsed) {
        setTime(formatScheduleTime(parsed.hour, parsed.minute));
        if (parsed.day !== null) setDay(parsed.day);
      }
    }
    setKind(next);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <input type="hidden" name={name} value={value} data-default-value={defaultCron} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Repeats" htmlFor={`${id}Kind`}>
          <SelectWrapper>
            <select
              id={`${id}Kind`}
              value={kind}
              onChange={(e) => {
                changeKind(e.target.value as ScheduleKind);
              }}
              className={selectClass}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="advanced">Advanced (cron)</option>
            </select>
          </SelectWrapper>
        </Field>
        {kind === "weekly" && (
          <Field label="On" htmlFor={`${id}Day`}>
            <SelectWrapper>
              <select
                id={`${id}Day`}
                value={day}
                onChange={(e) => {
                  setDay(Number(e.target.value));
                }}
                className={selectClass}
              >
                {WEEKDAYS.map((weekday, i) => (
                  <option key={weekday} value={i}>
                    {weekday}
                  </option>
                ))}
              </select>
            </SelectWrapper>
          </Field>
        )}
        {kind !== "advanced" ? (
          <Field label="At" htmlFor={`${id}Time`}>
            <input
              id={`${id}Time`}
              type="time"
              step={60}
              required
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
              }}
              className={inputClass}
            />
          </Field>
        ) : (
          <Field label="Cron expression" htmlFor={id} hint="minute hour day-of-month month day-of-week">
            <input
              id={id}
              value={cron}
              onChange={(e) => {
                setCron(e.target.value);
              }}
              placeholder="0 8 * * *"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        )}
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
