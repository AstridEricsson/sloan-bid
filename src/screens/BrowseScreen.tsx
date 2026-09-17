import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import type { Course, Section, Term } from '../types';
import { ALL_COURSES, STUDENT } from '../data/courses';
import { computeSchedule, termsConflict, getAssignedSection } from '../utils/scheduleEngine';
import { StarRating } from '../components/StarRating';
import { SectionToggle } from '../components/SectionToggle';

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

type Slot = { day: string; start: number; end: number; term: string | null };

function slotsConflict(a: Slot, b: Slot) {
  if (a.day !== b.day) return false;
  if (a.start >= b.end || a.end <= b.start) return false;
  if ((a.term === 'H3' && b.term === 'H4') || (a.term === 'H4' && b.term === 'H3')) return false;
  return true;
}

function sectionFits(section: Section, courseTerm: string, occupied: Slot[]): boolean {
  for (const day of section.dayKeys) {
    for (const o of occupied) {
      if (o.day !== day) continue;
      if (section.startHour >= o.end || section.endHour <= o.start) continue;
      if (!termsConflict(courseTerm as 'Full' | 'H3' | 'H4', o.term as 'Full' | 'H3' | 'H4' | null)) continue;
      return false;
    }
  }
  return true;
}

export function BrowseScreen() {
  const {
    needToHave,
    niceToHave,
    optional,
    setOptional,
    sectionOverrides,
    setSectionOverride,
    addedCourses,
    addCourse,
    setScreen,
    browseAddedIds,
    addBrowseAddedId,
    deselectedIds,
    setDeselectedIds,
  } = useApp();

  const [search, setSearch] = useState('');
  const [filterDay, setFilterDay] = useState<string>('');
  const [filterMinRating, setFilterMinRating] = useState<number>(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── Replicate ScheduleScreen's blockedNiceIds logic ──

  const obligatorySlots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
    day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
  }));

  // Step 1: Visible needs — deselected courses stay in the tier but are
  // excluded from the schedule, matching the Schedule pages.
  const visibleNeed = needToHave.filter((c) => !deselectedIds.has(c.id));

  // Step 2: Need-only schedule to get base slots
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

  // Step 3: Identify blocked Nice-to-Haves (no section fits against needs)
  const blockedNiceIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const c of niceToHave) {
      const canFit = c.sections.some((sec) => {
        const slots: Slot[] = sec.dayKeys.map((d) => ({ day: d, start: sec.startHour, end: sec.endHour, term: c.term as Term }));
        return !slots.some((s) => needBaseSlots.some((o) => slotsConflict(s, o)));
      });
      if (!canFit) blocked.add(c.id);
    }
    return blocked;
  }, [niceToHave, needBaseSlots]);

  // Step 4: Visible nices = not deselected and not blocked
  const visibleNice = niceToHave.filter((c) => !deselectedIds.has(c.id) && !blockedNiceIds.has(c.id));

  // Step 4b: Visible optionals = not deselected (blocked-optional analysis
  // isn't replicated here since Browse only adds courses that already fit)
  const visibleOptional = optional.filter((c) => !deselectedIds.has(c.id));

  // Step 5: Full schedule with all visible courses
  const placedBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: visibleNice, optional: visibleOptional, sectionOverrides }),
    [visibleNeed, visibleNice, visibleOptional, sectionOverrides]
  );

  // Build occupied slots from ALL placed blocks (including conflicting ones).
  // Keep each block's real term so H3/Full/H4 conflicts are judged the same
  // way as everywhere else — an H3 and an H4 course in the same time slot
  // are compatible (different halves of the semester), not a conflict.
  const occupiedSlots: Slot[] = useMemo(() => {
    const slots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
      day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
    }));
    for (const b of placedBlocks) {
      if (!b.couldntFit) {
        slots.push({ day: b.day, start: b.section.startHour, end: b.section.endHour, term: b.course.term });
      }
    }
    return slots;
  }, [placedBlocks]);

  // Total units from placed (non-conflicting) courses
  const totalUnits = useMemo(() => {
    const placedCourseIds = new Set<string>();
    for (const b of placedBlocks) {
      if (!b.couldntFit && !b.conflict) placedCourseIds.add(b.course.id);
    }
    return [...placedCourseIds].reduce((sum, id) => {
      const course = [...needToHave, ...niceToHave, ...optional].find((c) => c.id === id);
      return sum + (course?.units ?? 0);
    }, 0);
  }, [placedBlocks, needToHave, niceToHave, optional]);

  // IDs of all courses already added or in any tier
  const addedIds = useMemo(() => {
    const ids = new Set(addedCourses.map((c) => c.id));
    for (const c of needToHave) ids.add(c.id);
    for (const c of niceToHave) ids.add(c.id);
    for (const c of optional) ids.add(c.id);
    return ids;
  }, [addedCourses, needToHave, niceToHave, optional]);

  // Find courses that fit and aren't already added
  const fittingCourses = useMemo(() => {
    return ALL_COURSES.filter((c) => {
      if (addedIds.has(c.id)) return false;
      if (c.isCompleted) return false;
      if (c.isObligatory) return false;
      // At least one section must fit
      return c.sections.some((s) => sectionFits(s, c.term, occupiedSlots));
    });
  }, [addedIds, occupiedSlots]);

  // Apply search/day/rating filters
  const filtered = useMemo(() => {
    return fittingCourses.filter((c) => {
      if (search && !c.title.toLowerCase().includes(search.toLowerCase()) &&
          !c.number.toLowerCase().includes(search.toLowerCase()) &&
          !c.professor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterDay && !c.sections.some((s) => s.dayKeys.includes(filterDay))) return false;
      if (filterMinRating && c.rating < filterMinRating) return false;
      return true;
    });
  }, [fittingCourses, search, filterDay, filterMinRating]);

  const handleAddAsOptional = (e: React.MouseEvent, course: Course) => {
    e.stopPropagation();
    addCourse(course);
    // Pin to the fitting section at add time — it's what makes this course
    // "compatible"; it can be turned off and back on, but not switched, or
    // it could stop being compatible with the rest of the schedule.
    const fittingSection = course.sections.find((s) => sectionFits(s, course.term, occupiedSlots));
    if (fittingSection) {
      setSectionOverride(course.id, fittingSection.id);
    }
    setOptional([...optional, course]);
    addBrowseAddedId(course.id);
  };

  // De-check / re-check a course added from Browse — same toggle as the
  // Schedule pages: it stays listed, just excluded from the schedule when off.
  const toggleBrowseAdded = (courseId: string) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  // Browse-added courses still in tiers
  const browseAddedCourses = useMemo(() => {
    const allTiered = [...needToHave, ...niceToHave, ...optional];
    return allTiered.filter((c) => browseAddedIds.has(c.id));
  }, [needToHave, niceToHave, optional, browseAddedIds]);

  const handleCardClick = (id: string) => {
    setExpanded(expanded === id ? null : id);
  };

  return (
    <div className="screen browse-screen">
      <button className="browse-back-link" onClick={() => setScreen('schedule-optional')}>
        ← Back to Schedule
      </button>

      {/* Schedule — same layout and size as the Schedule pages */}
      <div className="schedule-layout">
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
            const dayBlocks = placedBlocks.filter((b) => b.day === day && !b.couldntFit);
            const oblBlock = STUDENT.obligatoryBlocks.find((ob) => ob.day === day);

            // Split blocks that overlap in time but coexist (different halves
            // of the semester) side by side instead of stacking them.
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

                    return (
                      <div
                        key={`${block.course.id}-${idx}`}
                        className={`cal-block ${cls} ${block.course.isObligatory && !block.conflict ? 'cal-block-obligatory' : ''}`}
                        style={blockStyle}
                        title={block.course.title}
                      >
                        {block.course.isObligatory && <span className="block-obligatory-badge">SFMBA Obligatory</span>}
                        <span className="block-number">{block.course.number}</span>
                        <span className="block-title">{block.course.title}</span>
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
          <span className="legend-item"><span className="legend-dot dot-nice" />Nice-to-Have</span>
          <span className="legend-item"><span className="legend-dot dot-optional" />Optional</span>
          <span className="legend-item"><span className="legend-dot dot-obligatory" />Obligatory</span>
        </div>

        <button className="save-schedule-btn browse-go-bidding" onClick={() => setScreen('bidding')}>
          I'm happy with this — go to bidding ➜
        </button>
        </div>

        <div className="sidebar-col">
          <div className="units-counter">
            <span className="units-number">{totalUnits}</span>
            <span className="units-label">units</span>
          </div>

          {/* Added from Browse — same de-check/re-check toggle as the Schedule pages.
              Section is fixed at add time and can't be switched, or the course
              could stop being compatible with the rest of the schedule. */}
          {browseAddedCourses.length > 0 && (
            <div className="bid-sidebar">
              <div className="bid-header">
                <h2 className="bid-title">Added from Browse</h2>
              </div>
              <div className="bid-section">
                {browseAddedCourses.map((course) => (
                  <SectionToggle
                    key={course.id}
                    course={course}
                    currentSectionId={getAssignedSection(placedBlocks, course.id)?.id || sectionOverrides[course.id] || null}
                    onToggle={() => toggleBrowseAdded(course.id)}
                    hidden={deselectedIds.has(course.id)}
                    tier="optional"
                    overlapIds={new Set()}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Browse Courses Panel — full width, below the schedule */}
      <div className="browse-courses">
        <h2 className="browse-heading">Browse compatible</h2>
        <p className="browse-subtitle">{filtered.length} course{filtered.length !== 1 ? 's' : ''} available</p>

        {/* Filter Bar */}
        <div className="browse-filter-bar">
          <div className="search-input-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="text"
              placeholder="Search courses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>

          <div className="filter-group">
            <div className="filter-chips">
              {DAYS.map((d) => (
                <button
                  key={d}
                  className={`chip ${filterDay === d ? 'active' : ''}`}
                  onClick={() => setFilterDay(filterDay === d ? '' : d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <div className="filter-chips">
              {[4.0, 4.5].map((r) => (
                <button
                  key={r}
                  className={`chip ${filterMinRating === r ? 'active' : ''}`}
                  onClick={() => setFilterMinRating(filterMinRating === r ? 0 : r)}
                >
                  ★ {r}+
                </button>
              ))}
            </div>
          </div>

          {(filterDay || filterMinRating > 0) && (
            <button className="filter-clear-all" onClick={() => { setFilterDay(''); setFilterMinRating(0); }}>
              Clear filters
            </button>
          )}
        </div>

        {/* Course List */}
        <div className="course-grid">
          {filtered.map((course) => (
            <div
              key={course.id}
              className={`course-card ${expanded === course.id ? 'expanded' : ''}`}
              onClick={() => handleCardClick(course.id)}
            >
              <div className="course-card-header">
                <div className="course-number">
                  {course.number}
                  <span className={`term-badge term-${course.term.toLowerCase()}`}>{course.term} · {course.units}u</span>
                </div>
                <button
                  className="add-btn"
                  onClick={(e) => handleAddAsOptional(e, course)}
                  title="Add to schedule as optional"
                >
                  +
                </button>
              </div>

              <h3 className="course-title">{course.title}</h3>
              <p className="course-professor">{course.professor}</p>

              <StarRating rating={course.rating} size="sm" />

              <p className="course-quote">"{course.reviewQuote}"</p>

              <span className="course-expand-hint">
                {expanded === course.id ? 'Show less ▲' : 'Read more ▼'}
              </span>

              <div className="course-sections-preview">
                {course.sections.map((s) => {
                  const fits = sectionFits(s, course.term, occupiedSlots);
                  return (
                    <span key={s.id} className={`section-tag ${fits ? 'browse-section-fit' : 'browse-section-nofit'}`}>
                      {s.days} · {s.time} {fits ? '✓' : ''}
                    </span>
                  );
                })}
              </div>

              {/* Expanded Detail */}
              {expanded === course.id && (
                <div className="course-expanded" onClick={(e) => e.stopPropagation()}>
                  <div className="expanded-divider" />
                  <div className="expanded-syllabus">
                    <div className="syllabus-icon">&#x1F4D8;</div>
                    <h4 className="expanded-label">Course Overview</h4>
                    <p className="course-description">{course.description}</p>
                  </div>
                  <div className="expanded-sections">
                    <h4 className="expanded-label">Available Sections</h4>
                    {course.sections.map((s) => {
                      const fits = sectionFits(s, course.term, occupiedSlots);
                      return (
                        <div key={s.id} className={`expanded-section-row ${fits ? '' : 'browse-section-nofit'}`}>
                          <span className="section-days">{s.days}</span>
                          <span className="section-time">{s.time}</span>
                          {fits && <span className="browse-fit-badge">Fits</span>}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="save-schedule-btn browse-add-expanded-btn"
                    onClick={(e) => handleAddAsOptional(e, course)}
                  >
                    Add as Optional
                  </button>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">◎</div>
              <p>No fitting courses match your filters.</p>
              {(search || filterDay || filterMinRating > 0) && (
                <button onClick={() => { setSearch(''); setFilterDay(''); setFilterMinRating(0); }}>
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
