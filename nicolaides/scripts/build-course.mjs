// Compacts the research package's schedule tables into src/data/course.json, the
// timetable the app runs. The package lives in research/ (ignored by git):
//   node scripts/build-course.mjs [path/to/nicolaides_schedule_templates.json]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const IN = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../research/nicolaides_schedule_templates.json"));
const OUT = resolve(import.meta.dirname, "../src/data/course.json");

const templates = JSON.parse(readFileSync(IN, "utf8"));
const exercises = {};
const schedules = templates.map((t) => ({
  n: t.schedule_number,
  section: t.section_title,
  page: t.source_print_page,
  repeat: t.repeat_rule?.directive ?? "none",
  mandatoryRepeats: t.repeat_rule?.mandatory_repeat_count ?? 0,
  homework: (t.homework_outside_three_hour_session ?? []).map((h) => h.description),
  days: t.days.map((day) => {
    let offset = 0;
    const steps = day.steps.map((s) => {
      if (s.start_offset_seconds !== offset) throw new Error(`S${t.schedule_number}${day.day_label} block ${s.block_index} starts at ${s.start_offset_seconds}, expected ${offset}`);
      offset = s.end_offset_seconds;
      if (s.kind === "break") return { kind: "rest", seconds: s.duration_seconds };
      (s.exercise_ids ?? []).forEach((id, i) => { exercises[id] = s.exercise_titles[i]; });
      return {
        kind: "draw",
        ex: s.exercise_ids,
        seconds: s.duration_seconds,
        count: [s.drawing_count_or_pose_count?.min ?? 1, s.drawing_count_or_pose_count?.max ?? 1],
        media: s.medium_ids ?? [],
        modes: s.reference_modes ?? [],
        subjects: s.subject_tags ?? [],
        ...(s.instructions_or_variants ? { note: s.instructions_or_variants } : {}),
        ...(s.artwork_group_id ? { group: s.artwork_group_id } : {}),
        ...(s.choice_one_of_exercises ? { choice: s.choice_one_of_exercises } : {}),
      };
    });
    if (offset !== 10800) throw new Error(`S${t.schedule_number}${day.day_label} lasts ${offset} s`);
    return { label: day.day_label, steps };
  }),
}));

// All 64 names, including those that appear only as homework.
const names = resolve(IN, "../nicolaides_exercises.json");
for (const e of JSON.parse(readFileSync(names, "utf8"))) exercises[e.exercise_id] = e.title;
writeFileSync(OUT, JSON.stringify({ exercises, schedules }));
console.log(`${schedules.length} schedules, ${schedules.length * 5} days, ${Object.keys(exercises).length} exercises named in the tables`);
