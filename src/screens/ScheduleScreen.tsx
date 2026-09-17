import { useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Course, Term } from '../types';
import { STUDENT } from '../data/courses';
import { computeSchedule, getAssignedSection } from '../utils/scheduleEngine';

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const START_HOUR = 8.5;
const END_HOUR = 19;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function hourToPercent(hour: number) {
  return ((hour - START_HOUR) / TOTAL_HOURS) * 100;
}

function durationToPercent(start: number, end: number) {
  return ((end - start) / TOTAL_HOURS) * 100;
}

function formatHour(h: number) {
  const hh = Math.floor(h);
  const mm = h % 1 === 0.5 ? '30' : '00';
  const ampm = hh < 12 ? 'am' : 'pm';
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${display}${mm === '00' ? '' : ':' + mm}${ampm}`;
}

function formatTimeRange(start: number, end: number) {
  return `${formatHour(start)}–${formatHour(end)}`;
}

export type ScheduleStage = 'need' | 'nice' | 'optional';

export function ScheduleScreen({ stage }: { stage: ScheduleStage }) {
  const {
    addedCourses,
    needToHave,
    niceToHave,
    optional,
    setNeedToHave,
    setNiceToHave,
    setOptional,
    setScreen,
    sectionOverrides,
    setSectionOverride,
    removeSectionOverride,
    sacrificedFrom,
    setSacrificedFrom,
  } = useApp();
  const [showConflictToast, setShowConflictToast] = useState(false);

  // Blocked Nice-to-Haves the user explicitly re-checked to see overlaps
  const [forcedVisibleIds, setForcedVisibleIds] = useState<Set<string>>(new Set());
  const overlapIdsRef = useRef<Set<string>>(new Set());
  const niceOverlapIdsRef = useRef<Set<string>>(new Set());
  const optOverlapIdsRef = useRef<Set<string>>(new Set());

  type Tier = 'need' | 'nice' | 'optional';

  // Shared conflict analysis helpers
  type Slot = { day: string; start: number; end: number; term: Term | null };

  function slotsConflict(a: Slot, b: Slot) {
    if (a.day !== b.day) return false;
    if (a.start >= b.end || a.end <= b.start) return false;
    if ((a.term === 'H3' && b.term === 'H4') || (a.term === 'H4' && b.term === 'H3')) return false;
    return true;
  }

  const obligatorySlots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
    day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
  }));

  // ── Step 1: Visible needs ──
  const visibleNeed = needToHave;

  // ── Step 2: Compute need-only schedule to get base slots (independent of nice visibility) ──
  const needOnlyBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: [], optional: [], sectionOverrides }),
    [visibleNeed, sectionOverrides]
  );

  const needBaseSlots = useMemo(() => {
    const slots: Slot[] = [...obligatorySlots];
    for (const b of needOnlyBlocks) {
      if (b.tier === 'need' && !b.conflict) {
        slots.push({ day: b.day, start: b.section.startHour, end: b.section.endHour, term: b.course.term });
      }
    }
    return slots;
  }, [needOnlyBlocks]);

  // ── Step 3: Identify blocked Nice-to-Haves (no section fits against needs) ──
  const blockedNiceIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const c of niceToHave) {
      const canFit = c.sections.some((sec) => {
        const slots: Slot[] = sec.dayKeys.map((d) => ({ day: d, start: sec.startHour, end: sec.endHour, term: c.term }));
        return !slots.some((s) => needBaseSlots.some((o) => slotsConflict(s, o)));
      });
      if (!canFit) blocked.add(c.id);
    }
    return blocked;
  }, [niceToHave, needBaseSlots]);

  // ── Step 4: Visible nices = not blocked, or forced visible ──
  const visibleNice = niceToHave.filter((c) => {
    if (blockedNiceIds.has(c.id) && !forcedVisibleIds.has(c.id)) return false;
    return true;
  });

  // ── Step 4b: Compute need+nice base slots for optional analysis ──
  const needNiceBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: visibleNice, optional: [], sectionOverrides }),
    [visibleNeed, visibleNice, sectionOverrides]
  );

  const needNiceBaseSlots = useMemo(() => {
    const slots: Slot[] = [...obligatorySlots];
    for (const b of needNiceBlocks) {
      if (!b.conflict) {
        slots.push({ day: b.day, start: b.section.startHour, end: b.section.endHour, term: b.course.term });
      }
    }
    return slots;
  }, [needNiceBlocks]);

  // ── Step 4c: Identify blocked Optionals (no section fits against need+nice) ──
  const blockedOptionalIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const c of optional) {
      const canFit = c.sections.some((sec) => {
        const slots: Slot[] = sec.dayKeys.map((d) => ({ day: d, start: sec.startHour, end: sec.endHour, term: c.term }));
        return !slots.some((s) => needNiceBaseSlots.some((o) => slotsConflict(s, o)));
      });
      if (!canFit) blocked.add(c.id);
    }
    return blocked;
  }, [optional, needNiceBaseSlots]);

  // ── Step 5: Full schedule with all visible courses ──
  const visibleOptional = optional.filter((c) => {
    if (blockedOptionalIds.has(c.id) && !forcedVisibleIds.has(c.id)) return false;
    return true;
  });

  const placedBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: visibleNice, optional: visibleOptional, sectionOverrides }),
    [visibleNeed, visibleNice, visibleOptional, sectionOverrides]
  );

  // Only render/consider tiers up through the current stage — Need-to-Have
  // is scheduled first, then Nice-to-Have builds on top of it, then Optional
  // builds on both, matching the step-by-step flow in the sidebar.
  const stageBlocks = stage === 'need' ? needOnlyBlocks : stage === 'nice' ? needNiceBlocks : placedBlocks;
  const showNice = stage === 'nice' || stage === 'optional';
  const showOptional = stage === 'optional';

  // Effective hidden check
  const isHidden = (courseId: string) => {
    if (blockedNiceIds.has(courseId) && !forcedVisibleIds.has(courseId)) return true;
    if (blockedOptionalIds.has(courseId) && !forcedVisibleIds.has(courseId)) return true;
    return false;
  };

  const tierOf = (courseId: string): Tier | null => {
    if (needToHave.some((c) => c.id === courseId)) return 'need';
    if (niceToHave.some((c) => c.id === courseId)) return 'nice';
    if (optional.some((c) => c.id === courseId)) return 'optional';
    return null;
  };

  // Apply a batch of removals (sacrifice) and additions (put back) against
  // the tier arrays in one pass per tier, so combined operations (like a
  // swap) never clobber each other via stale-closure double setState calls.
  const updateTiers = (removeIds: Set<string>, addCourses: Course[]) => {
    const addByTier: Record<Tier, Course[]> = { need: [], nice: [], optional: [] };
    for (const c of addCourses) {
      const t = sacrificedFrom[c.id];
      if (t) addByTier[t].push(c);
    }
    setNeedToHave([...needToHave.filter((c) => !removeIds.has(c.id)), ...addByTier.need]);
    setNiceToHave([...niceToHave.filter((c) => !removeIds.has(c.id)), ...addByTier.nice]);
    setOptional([...optional.filter((c) => !removeIds.has(c.id)), ...addByTier.optional]);
  };

  // Sacrifice one or more courses at once, so they show up as "not
  // categorized" back in Prioritize, and remember where each came from.
  const sacrificeCourses = (courseIds: string[]) => {
    const nextSacrificed = { ...sacrificedFrom };
    for (const id of courseIds) {
      const tier = tierOf(id);
      if (tier) nextSacrificed[id] = tier;
    }
    setSacrificedFrom(nextSacrificed);
    updateTiers(new Set(courseIds), []);

    // Clear section overrides for sibling problem-group courses
    for (const ref of [overlapIdsRef, niceOverlapIdsRef, optOverlapIdsRef]) {
      for (const courseId of courseIds) {
        if (ref.current.has(courseId)) {
          for (const id of ref.current) {
            if (!courseIds.includes(id)) removeSectionOverride(id);
          }
        }
      }
    }
  };

  // Put a sacrificed course back into the tier it came from.
  const putBackCourse = (courseId: string) => {
    const course = addedCourses.find((c) => c.id === courseId);
    if (!sacrificedFrom[courseId] || !course) return;

    updateTiers(new Set(), [course]);
    const next = { ...sacrificedFrom };
    delete next[courseId];
    setSacrificedFrom(next);
  };

  // Bring a sacrificed course back by sacrificing a different one in its
  // place, clearing overrides on the courses that stay so they re-optimize.
  const swapSacrifice = (bringBackId: string, sacrificeIds: string[], currentVisible: Course[]) => {
    for (const c of currentVisible) {
      if (!sacrificeIds.includes(c.id)) removeSectionOverride(c.id);
    }
    const bringBackCourse = addedCourses.find((c) => c.id === bringBackId);
    if (!bringBackCourse) return;

    const nextSacrificed = { ...sacrificedFrom };
    for (const id of sacrificeIds) {
      const tier = tierOf(id);
      if (tier) nextSacrificed[id] = tier;
    }
    delete nextSacrificed[bringBackId];
    setSacrificedFrom(nextSacrificed);
    updateTiers(new Set(sacrificeIds), [bringBackCourse]);
  };

  // Toggle handler
  const toggleCourse = (courseId: string) => {
    if (blockedNiceIds.has(courseId) || blockedOptionalIds.has(courseId)) {
      // Blocked course: toggle forced visibility
      setForcedVisibleIds((prev) => {
        const next = new Set(prev);
        if (next.has(courseId)) next.delete(courseId);
        else next.add(courseId);
        return next;
      });
    } else {
      sacrificeCourses([courseId]);
    }
  };

  // Build a set of need-to-have course IDs for quick lookup
  const needIds = new Set(needToHave.map((c) => c.id));

  function computeMaxFit(courses: Course[], base: Slot[]): number {
    let best = 0;
    function solve(idx: number, occupied: Slot[], count: number) {
      if (count > best) best = count;
      if (idx === courses.length) return;
      if (count + (courses.length - idx) <= best) return;
      const course = courses[idx];
      const overrideId = sectionOverrides[course.id];
      const overrideSection = overrideId ? course.sections.find((s) => s.id === overrideId) : undefined;
      const candidateSections = overrideSection ? [overrideSection] : course.sections;
      for (const sec of candidateSections) {
        const newSlots: Slot[] = sec.dayKeys.map((d) => ({
          day: d, start: sec.startHour, end: sec.endHour, term: course.term,
        }));
        if (!newSlots.some((s) => occupied.some((o) => slotsConflict(s, o)))) {
          solve(idx + 1, [...occupied, ...newSlots], count + 1);
        }
      }
      solve(idx + 1, occupied, count);
    }
    solve(0, [...base], 0);
    return best;
  }

  // If `course` (currently sacrificed) were put back, does it fit cleanly,
  // or does it take sacrificing one (or two) currently-visible courses instead?
  // Returns every valid combination at the smallest size that works.
  function computeSwapPreview(course: Course, currentVisible: Course[], base: Slot[]) {
    const trial = [...currentVisible, course];
    const maxFit = computeMaxFit(trial, base);
    if (maxFit === trial.length) {
      return { needsSacrifice: false, sacrificeOptions: [] as Course[][] };
    }
    const droppable = currentVisible.filter((c) => !c.isObligatory);
    for (const size of [1, 2]) {
      const options = combinations(droppable, size).filter((combo) => {
        const remaining = trial.filter((c) => !combo.some((x) => x.id === c.id));
        return computeMaxFit(remaining, base) === remaining.length;
      });
      if (options.length > 0) {
        return { needsSacrifice: true, sacrificeOptions: options };
      }
    }
    return { needsSacrifice: true, sacrificeOptions: [] as Course[][] };
  }

  function analyzeConflicts(courses: Course[], base: Slot[]) {
    const empty = {
      ids: new Set<string>(),
      message: null as string | null,
      dropOptions: [] as Course[][],
      groupIds: [] as string[],
    };
    if (courses.length === 0) return empty;

    const n = courses.length;
    const maxFitAll = computeMaxFit(courses, base);

    if (maxFitAll === n) {
      const ids = new Set<string>();
      const blocks = placedBlocks.filter((b) => !b.couldntFit);
      for (const a of blocks) {
        if (!courses.find((c) => c.id === a.course.id)) continue;
        for (const b of blocks) {
          if (!courses.find((c) => c.id === b.course.id)) continue;
          if (a.course.id >= b.course.id || a.day !== b.day) continue;
          if (a.section.startHour < b.section.endHour && a.section.endHour > b.section.startHour) {
            if ((a.course.term === 'H3' && b.course.term === 'H4') || (a.course.term === 'H4' && b.course.term === 'H3')) continue;
            ids.add(a.course.id);
            ids.add(b.course.id);
          }
        }
      }
      if (ids.size > 0) {
        const overlapCourses = courses.filter((c) => ids.has(c.id));
        const switchable = overlapCourses.filter((c) => c.sections.length > 1);
        const names = overlapCourses.map((c) => c.title).join(', ');
        const msg = `⚠ ${names} currently overlap. Switch ${switchable.map((c) => c.title).join(' or ')} to a different section to resolve.`;
        return { ...empty, ids, message: msg };
      }
      return empty;
    }

    const problemIds = new Set<string>();
    for (let i = 0; i < n; i++) {
      const remaining = courses.filter((_, j) => j !== i);
      if (computeMaxFit(remaining, base) >= maxFitAll) {
        problemIds.add(courses[i].id);
      }
    }

    // Also include courses that conflict with problem courses (e.g. obligatory courses)
    const allInvolvedIds = new Set(problemIds);
    const problemCourses = courses.filter((c) => problemIds.has(c.id));
    for (const c of courses) {
      if (allInvolvedIds.has(c.id)) continue;
      const conflictsWithProblem = problemCourses.some((pc) =>
        c.sections.some((cs) =>
          pc.sections.some((ps) =>
            cs.dayKeys.some((d) =>
              ps.dayKeys.includes(d) &&
              cs.startHour < ps.endHour &&
              cs.endHour > ps.startHour &&
              slotsConflict(
                { day: d, start: cs.startHour, end: cs.endHour, term: c.term },
                { day: d, start: ps.startHour, end: ps.endHour, term: pc.term }
              )
            )
          )
        )
      );
      if (conflictsWithProblem) allInvolvedIds.add(c.id);
    }

    const allInvolved = courses.filter((c) => allInvolvedIds.has(c.id));
    const involvedMaxFit = computeMaxFit(allInvolved, base);
    const obligatoryInvolved = allInvolved.filter((c) => c.isObligatory);
    const droppableCount = allInvolved.length - involvedMaxFit;
    const names = allInvolved.map((c) => c.title).join(', ');

    // If dropping exactly 1 or 2 courses resolves it, enumerate every valid
    // combination of (non-obligatory) courses to drop as separate choices.
    let dropOptions: Course[][] = [];
    if (droppableCount === 1 || droppableCount === 2) {
      const droppable = allInvolved.filter((c) => !c.isObligatory);
      dropOptions = combinations(droppable, droppableCount).filter((combo) => {
        const remaining = allInvolved.filter((c) => !combo.some((x) => x.id === c.id));
        return computeMaxFit(remaining, base) === remaining.length;
      });
    }

    let msg = `⚠ ${names} cannot all fit — no section combination works. You can take at most ${involvedMaxFit} of these ${allInvolved.length}.`;
    if (dropOptions.length === 0) {
      if (obligatoryInvolved.length > 0) {
        msg += ` Uncheck ${droppableCount} other course${droppableCount !== 1 ? 's' : ''} to resolve.`;
      } else {
        msg += ` Uncheck ${droppableCount} to resolve.`;
      }
    }

    return {
      ids: allInvolvedIds,
      message: msg,
      dropOptions,
      groupIds: allInvolved.map((c) => c.id),
    };
  }

  // Need-to-Have conflict analysis
  const { overlapIds, conflictMessage, conflictDropOptions, conflictGroupIds } = useMemo(() => {
    const result = analyzeConflicts(visibleNeed, obligatorySlots);
    return {
      overlapIds: result.ids,
      conflictMessage: result.message,
      conflictDropOptions: result.dropOptions,
      conflictGroupIds: result.groupIds,
    };
  }, [visibleNeed, placedBlocks]);

  overlapIdsRef.current = overlapIds;

  // Nice-to-Have conflict analysis — only non-blocked visible nices
  const { niceOverlapIds, niceConflictMessage, niceConflictDropOptions, niceConflictGroupIds } = useMemo(() => {
    const analyzable = visibleNice.filter((c) => !blockedNiceIds.has(c.id));
    const result = analyzeConflicts(analyzable, needBaseSlots);
    return {
      niceOverlapIds: result.ids,
      niceConflictMessage: result.message,
      niceConflictDropOptions: result.dropOptions,
      niceConflictGroupIds: result.groupIds,
    };
  }, [visibleNice, blockedNiceIds, needBaseSlots, placedBlocks]);

  niceOverlapIdsRef.current = niceOverlapIds;

  // Optional conflict analysis — only non-blocked visible optionals
  const { optOverlapIds, optConflictMessage, optConflictDropOptions, optConflictGroupIds } = useMemo(() => {
    const analyzable = visibleOptional.filter((c) => !blockedOptionalIds.has(c.id));
    const result = analyzeConflicts(analyzable, needNiceBaseSlots);
    return {
      optOverlapIds: result.ids,
      optConflictMessage: result.message,
      optConflictDropOptions: result.dropOptions,
      optConflictGroupIds: result.groupIds,
    };
  }, [visibleOptional, blockedOptionalIds, needNiceBaseSlots, placedBlocks]);

  optOverlapIdsRef.current = optOverlapIds;

  // Accept a "drop these courses" choice: sacrifice them together and let the
  // rest of the conflict group re-optimize freely instead of staying pinned
  // to old overrides.
  const acceptDropOption = (dropCourses: Course[], groupIds: string[]) => {
    const dropIds = new Set(dropCourses.map((c) => c.id));
    for (const id of groupIds) {
      if (!dropIds.has(id)) removeSectionOverride(id);
    }
    sacrificeCourses(dropCourses.map((c) => c.id));
  };

  // Total units from placed (non-conflicting) courses in tiers up through this stage
  const placedCourseIds = new Set<string>();
  for (const b of stageBlocks) {
    if (!b.couldntFit && !b.conflict) placedCourseIds.add(b.course.id);
  }
  const totalUnits = [...placedCourseIds].reduce((sum, id) => {
    const course = [...needToHave, ...niceToHave, ...optional].find((c) => c.id === id);
    return sum + (course?.units ?? 0);
  }, 0);

  // Courses sacrificed from this screen, with a preview of what putting
  // each one back would cost (nothing, or exactly one other course).
  // Only surface sacrifices for tiers already unlocked at this stage.
  const stageAllowsTier = (tier: 'need' | 'nice' | 'optional') =>
    tier === 'need' || (tier === 'nice' && showNice) || (tier === 'optional' && showOptional);

  const sacrificedCourses = Object.entries(sacrificedFrom)
    .filter(([, tier]) => stageAllowsTier(tier))
    .map(([id, tier]) => {
      const course = addedCourses.find((c) => c.id === id);
      if (!course) return null;
      const currentVisible = tier === 'need' ? visibleNeed : tier === 'nice' ? visibleNice : visibleOptional;
      const base = tier === 'need' ? obligatorySlots : tier === 'nice' ? needBaseSlots : needNiceBaseSlots;
      return { course, tier, currentVisible, preview: computeSwapPreview(course, currentVisible, base) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (needToHave.length === 0) {
    return (
      <div className="screen schedule-screen">
        <div className="empty-state">
          <div className="empty-icon">▦</div>
          <p>No courses prioritized yet.</p>
          <button onClick={() => setScreen('prioritize')}>Go to Prioritize →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen schedule-screen">
      <div className="schedule-layout">
        {/* Calendar Grid */}
        <div className="calendar-wrap">
          <div className="calendar-grid">
            {/* Time column */}
            <div className="time-col">
              <div className="day-header-spacer" />
              <div className="time-body">
                {Array.from({ length: Math.floor(END_HOUR) - Math.ceil(START_HOUR) + 1 }).map((_, i) => {
                  const h = Math.ceil(START_HOUR) + i;
                  return (
                    <div key={h} className="time-label" style={{ top: `${hourToPercent(h)}%` }}>
                      {formatHour(h)}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day columns */}
            {DAYS.map((day) => {
              const dayBlocks = stageBlocks.filter((b) => b.day === day && !b.couldntFit);
              const oblBlock = STUDENT.obligatoryBlocks.find((ob) => ob.day === day);

              // Compute overlap layout: split overlapping blocks horizontally
              const overlapLayout = new Map<string, { col: number; total: number }>();
              const assigned = new Set<number>();
              for (let i = 0; i < dayBlocks.length; i++) {
                if (assigned.has(i)) continue;
                const group = [i];
                assigned.add(i);
                for (let j = i + 1; j < dayBlocks.length; j++) {
                  if (assigned.has(j)) continue;
                  const overlaps = group.some((gi) =>
                    dayBlocks[gi].section.startHour < dayBlocks[j].section.endHour &&
                    dayBlocks[gi].section.endHour > dayBlocks[j].section.startHour
                  );
                  if (overlaps) {
                    group.push(j);
                    assigned.add(j);
                  }
                }
                if (group.length > 1) {
                  group.forEach((gi, col) => {
                    overlapLayout.set(dayBlocks[gi].course.id, { col, total: group.length });
                  });
                }
              }

              return (
                <div key={day} className="day-col">
                  <div className="day-header">{day}</div>
                  <div className="day-body">
                    {/* Hour grid lines */}
                    {Array.from({ length: Math.floor(END_HOUR) - Math.ceil(START_HOUR) + 1 }).map((_, i) => {
                      const h = Math.ceil(START_HOUR) + i;
                      return (
                        <div
                          key={h}
                          className="hour-line"
                          style={{ top: `${hourToPercent(h)}%` }}
                        />
                      );
                    })}

                    {/* Obligatory block */}
                    {oblBlock && (
                      <div
                        className="cal-block cal-block-obligatory"
                        style={{
                          top: `${hourToPercent(oblBlock.startHour)}%`,
                          height: `${durationToPercent(oblBlock.startHour, oblBlock.endHour)}%`,
                        }}
                        title={oblBlock.label}
                      >
                        <span className="block-label">{oblBlock.label}</span>
                      </div>
                    )}

                    {/* Course blocks */}
                    {dayBlocks.map((block, idx) => {
                      const cls = block.conflict
                        ? 'cal-block-conflict'
                        : block.tier === 'need'
                        ? 'cal-block-need'
                        : block.tier === 'nice'
                        ? 'cal-block-nice'
                        : 'cal-block-optional';

                      const isNeed = needIds.has(block.course.id);
                      const hasAlt = isNeed && block.course.sections.length > 1;
                      const altSection = hasAlt
                        ? block.course.sections.find((s) => s.id !== block.section.id)
                        : null;

                      // Split overlapping blocks side by side
                      const layout = overlapLayout.get(block.course.id);
                      const blockStyle: React.CSSProperties = {
                        top: `${hourToPercent(block.section.startHour)}%`,
                        height: `${durationToPercent(block.section.startHour, block.section.endHour)}%`,
                        ...(layout && {
                          left: `calc(3px + ${layout.col} * (100% - 6px) / ${layout.total})`,
                          width: `calc((100% - 6px) / ${layout.total})`,
                          right: 'auto',
                        }),
                      };
                      const blockTitle = block.conflict
                        ? `⚠ ${block.course.title} conflicts with another course`
                        : block.course.title;

                      return (
                        <div
                          key={`${block.course.id}-${idx}`}
                          className={`cal-block ${cls} ${block.course.isObligatory && !block.conflict ? 'cal-block-obligatory' : ''}`}
                          style={blockStyle}
                          title={blockTitle}
                        >
                          {block.course.isObligatory && <span className="block-obligatory-badge">SFMBA Obligatory</span>}
                          <span className="block-number">{block.course.number}</span>
                          <span className="block-title">{block.course.title}</span>
                          {block.conflict && <span className="block-conflict-icon">⚠</span>}
                          {altSection && (
                            <button
                              className="block-switch-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSectionOverride(block.course.id, altSection.id);
                              }}
                              title={`Switch to ${altSection.days} ${altSection.time}`}
                            >
                              ⇄ {formatTimeRange(altSection.startHour, altSection.endHour)}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="cal-legend">
            <span className="legend-item"><span className="legend-dot dot-need" />Need-to-Have</span>
            {showNice && <span className="legend-item"><span className="legend-dot dot-nice" />Nice-to-Have</span>}
            {showOptional && <span className="legend-item"><span className="legend-dot dot-optional" />Optional</span>}
            <span className="legend-item"><span className="legend-dot dot-obligatory" />Obligatory</span>
          </div>

          {/* Continue button */}
          <button
            className="save-schedule-btn"
            onClick={() => {
              const blockingConflict =
                stage === 'need'
                  ? conflictMessage
                  : stage === 'nice'
                  ? conflictMessage || niceConflictMessage
                  : conflictMessage || niceConflictMessage || optConflictMessage;
              if (blockingConflict) {
                setShowConflictToast(true);
                setTimeout(() => setShowConflictToast(false), 4000);
              } else if (stage === 'need') {
                setScreen('schedule-nice');
              } else if (stage === 'nice') {
                setScreen('schedule-optional');
              } else {
                setScreen('browse');
              }
            }}
          >
            {stage === 'need' && "I'm happy with this — add the Nice-to-Haves ➜"}
            {stage === 'nice' && "I'm happy with this — add the Optional ➜"}
            {stage === 'optional' && "I'm happy with this — browse compatible courses ➜"}
          </button>

          {showConflictToast && (
            <div className="obligatory-toast">
              Resolve the scheduling conflicts above before continuing.
            </div>
          )}

          {sacrificedCourses.length > 0 && (
            <div className="bid-sidebar sacrifice-panel">
              <div className="bid-header">
                <h2 className="bid-title">You Had to Sacrifice</h2>
              </div>
              {sacrificedCourses.map(({ course, currentVisible, preview }) => (
                <div key={course.id} className="sacrifice-row">
                  <div className="bid-row-info">
                    <span className="bid-row-number">{course.number}</span>
                    <span className="bid-row-title">{course.title}</span>
                    <span className={`term-badge term-badge-sm term-${course.term.toLowerCase()}`}>{course.term}</span>
                  </div>

                  {!preview.needsSacrifice && (
                    <button className="sacrifice-action-btn" onClick={() => putBackCourse(course.id)}>
                      Put it back
                    </button>
                  )}

                  {preview.needsSacrifice && preview.sacrificeOptions.length > 0 && (
                    <>
                      {preview.sacrificeOptions.map((combo, i) => (
                        <button
                          key={i}
                          className="sacrifice-action-btn"
                          onClick={() => swapSacrifice(course.id, combo.map((c) => c.id), currentVisible)}
                        >
                          Put {course.title} back, sacrifice {combo.map((c) => c.title).join(' and ')} instead
                        </button>
                      ))}
                    </>
                  )}

                  {preview.needsSacrifice && preview.sacrificeOptions.length === 0 && (
                    <p className="sacrifice-hint">
                      Won't fit back in without freeing up more than two courses.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section Toggle Sidebar */}
        <div className="sidebar-col">
          <div className="units-counter">
            <span className="units-number">{totalUnits}</span>
            <span className="units-label">units</span>
          </div>
          <div className="bid-sidebar">
            <div className="bid-header">
              <h2 className="bid-title">Sections</h2>
            </div>

            {needToHave.length > 0 && (
              <div className="bid-section">
                <div className="bid-section-label need">Need-to-Have</div>
                {needToHave.map((c) => (
                  <SectionToggle
                    key={c.id}
                    course={c}
                    currentSectionId={getAssignedSection(placedBlocks, c.id)?.id || null}
                    onToggle={() => toggleCourse(c.id)}
                    hidden={isHidden(c.id)}
                    tier="need"
                    overlapIds={overlapIds}
                  />
                ))}
              </div>
            )}

            {conflictMessage && (
              <div className="sidebar-hint">
                <p>{conflictMessage}</p>
                {conflictDropOptions.map((combo, i) => (
                  <button
                    key={i}
                    className="conflict-suggestion-btn"
                    onClick={() => acceptDropOption(combo, conflictGroupIds)}
                  >
                    Uncheck {combo.map((c) => c.title).join(' and ')}
                  </button>
                ))}
              </div>
            )}

            {showNice && niceToHave.length > 0 && (
              <div className="bid-section">
                <div className="bid-section-label nice">Nice-to-Have</div>
                {niceToHave.map((c) => (
                  <SectionToggle
                    key={c.id}
                    course={c}
                    currentSectionId={getAssignedSection(placedBlocks, c.id)?.id || null}
                    onToggle={() => toggleCourse(c.id)}
                    hidden={isHidden(c.id)}
                    tier="nice"
                    overlapIds={niceOverlapIds}
                  />
                ))}
              </div>
            )}

            {showNice && niceConflictMessage && (
              <div className="sidebar-hint">
                <p>{niceConflictMessage}</p>
                {niceConflictDropOptions.map((combo, i) => (
                  <button
                    key={i}
                    className="conflict-suggestion-btn"
                    onClick={() => acceptDropOption(combo, niceConflictGroupIds)}
                  >
                    Uncheck {combo.map((c) => c.title).join(' and ')}
                  </button>
                ))}
              </div>
            )}

            {showOptional && optional.length > 0 && (
              <div className="bid-section">
                <div className="bid-section-label optional">Optional</div>
                {optional.map((c) => (
                    <SectionToggle
                      key={c.id}
                      course={c}
                      currentSectionId={getAssignedSection(placedBlocks, c.id)?.id || null}
                      onToggle={() => toggleCourse(c.id)}
                      hidden={isHidden(c.id)}
                      tier="optional"
                      overlapIds={optOverlapIds}
                    />
                ))}
              </div>
            )}

            {showOptional && optConflictMessage && (
              <div className="sidebar-hint">
                <p>{optConflictMessage}</p>
                {optConflictDropOptions.map((combo, i) => (
                  <button
                    key={i}
                    className="conflict-suggestion-btn"
                    onClick={() => acceptDropOption(combo, optConflictGroupIds)}
                  >
                    Uncheck {combo.map((c) => c.title).join(' and ')}
                  </button>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

function SectionToggle({
  course,
  currentSectionId,
  onToggle,
  hidden,
  tier,
  overlapIds,
}: {
  course: Course;
  currentSectionId: string | null;
  onToggle: () => void;
  hidden: boolean;
  tier: 'need' | 'nice' | 'optional';
  overlapIds: Set<string>;
}) {
  const isConflicting = overlapIds.has(course.id);
  const assigned = course.sections.find((s) => s.id === currentSectionId) ?? course.sections[0];

  return (
    <div className={`bid-row bid-row-${tier} ${isConflicting ? 'bid-row-conflict' : ''} ${hidden ? 'bid-row-hidden' : ''}`}>
      {course.isObligatory ? (
        <span className="auto-status" title="Obligatory — cannot be removed">✓</span>
      ) : (
        <input
          type="checkbox"
          className="course-checkbox"
          checked={!hidden}
          onChange={onToggle}
          title={hidden ? 'Show on schedule' : 'Hide from schedule'}
        />
      )}
      <div className="bid-row-info">
        {course.isObligatory && <span className="obligatory-badge-sm">SFMBA Obligatory</span>}
        <span className="bid-row-number">{course.number}</span>
        <span className="bid-row-title">{course.title}</span>
        <span className={`term-badge term-badge-sm term-${course.term.toLowerCase()}`}>{course.term}</span>
      </div>
      <div className="section-toggle-group">
        <span className="section-single">{assigned?.days} {assigned?.time}</span>
      </div>
    </div>
  );
}
