import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import type { Course, Section, Term } from '../types';
import { ALL_COURSES, STUDENT } from '../data/courses';
import { computeSchedule, termsConflict } from '../utils/scheduleEngine';
import { StarRating } from '../components/StarRating';

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
    removeCourse,
    setScreen,
    browseAddedIds,
    addBrowseAddedId,
    clearBrowseAddedIds,
  } = useApp();

  const [search, setSearch] = useState('');
  const [filterDay, setFilterDay] = useState<string>('');
  const [filterMinRating, setFilterMinRating] = useState<number>(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savedConfirm, setSavedConfirm] = useState(false);

  // ── Replicate ScheduleScreen's blockedNiceIds logic ──

  const obligatorySlots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
    day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
  }));

  // Step 1: Visible needs
  const visibleNeed = needToHave;

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

  // Step 4: Visible nices = not blocked
  const visibleNice = niceToHave.filter((c) => !blockedNiceIds.has(c.id));

  // Step 5: Full schedule with all visible courses
  const placedBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: visibleNice, optional, sectionOverrides }),
    [visibleNeed, visibleNice, optional, sectionOverrides]
  );

  // Build occupied slots from ALL placed blocks (including conflicting ones)
  // Use term: null so ANY time overlap is blocked — no visual overlaps on calendar
  const occupiedSlots: Slot[] = useMemo(() => {
    const slots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
      day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
    }));
    for (const b of placedBlocks) {
      if (!b.couldntFit) {
        slots.push({ day: b.day, start: b.section.startHour, end: b.section.endHour, term: null });
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

  // Get occupied slots excluding a specific course (for section-fit checks)
  const getOccupiedExcluding = (courseId: string): Slot[] => {
    const slots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
      day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
    }));
    for (const b of placedBlocks) {
      if (!b.couldntFit && b.course.id !== courseId) {
        slots.push({ day: b.day, start: b.section.startHour, end: b.section.endHour, term: null });
      }
    }
    return slots;
  };

  const handleAddAsOptional = (e: React.MouseEvent, course: Course) => {
    e.stopPropagation();
    addCourse(course);
    // Pin to the first fitting section so it doesn't land on top of existing courses
    const fittingSection = course.sections.find((s) => sectionFits(s, course.term, occupiedSlots));
    if (fittingSection) {
      setSectionOverride(course.id, fittingSection.id);
    }
    setOptional([...optional, course]);
    addBrowseAddedId(course.id);
  };

  const handleRemoveBrowseAdded = (courseId: string) => {
    removeCourse(courseId);
  };

  const handleSectionToggle = (courseId: string, sectionId: string) => {
    setSectionOverride(courseId, sectionId);
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
      {/* Static Calendar */}
      <div className="browse-calendar">
        <div className="browse-calendar-header">
          <button className="browse-back-link" onClick={() => setScreen('schedule-optional')}>
            ← Back to Schedule
          </button>
          <div className="units-counter">
            <span className="units-number">{totalUnits}</span>
            <span className="units-label">units</span>
          </div>
        </div>

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

                    return (
                      <div
                        key={`${block.course.id}-${idx}`}
                        className={`cal-block ${cls} ${block.course.isObligatory && !block.conflict ? 'cal-block-obligatory' : ''}`}
                        style={{
                          top: `${hourToPercent(block.section.startHour)}%`,
                          height: `${durationToPercent(block.section.startHour, block.section.endHour)}%`,
                        }}
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

        {/* Added from Browse — section toggles + remove */}
        {browseAddedCourses.length > 0 && (
          <div className="browse-added-panel">
            <h4 className="browse-added-heading">Added from Browse</h4>
            {browseAddedCourses.map((course) => {
              const slotsExcluding = getOccupiedExcluding(course.id);
              const assignedSectionId = placedBlocks.find((b) => b.course.id === course.id)?.section.id;

              return (
                <div key={course.id} className="browse-added-row">
                  <div className="browse-added-info">
                    <span className="browse-added-number">{course.number}</span>
                    <span className="browse-added-title">{course.title}</span>
                  </div>
                  {course.sections.length > 1 && (
                    <div className="browse-added-sections">
                      {course.sections.map((s) => {
                        const fits = sectionFits(s, course.term, slotsExcluding);
                        const isActive = s.id === assignedSectionId;
                        return (
                          <button
                            key={s.id}
                            className={`browse-section-chip ${isActive ? 'active' : ''} ${!fits ? 'conflict' : ''}`}
                            onClick={() => handleSectionToggle(course.id, s.id)}
                          >
                            {s.days} · {s.time}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button
                    className="browse-added-remove"
                    onClick={() => handleRemoveBrowseAdded(course.id)}
                    title="Remove from schedule"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {browseAddedCourses.length > 0 && !savedConfirm && (
          <button
            className="save-schedule-btn browse-save-optional"
            onClick={() => { clearBrowseAddedIds(); setSavedConfirm(true); setTimeout(() => setSavedConfirm(false), 3000); }}
          >
            I'm happy with this — save as optional
          </button>
        )}

        {savedConfirm && (
          <div className="browse-saved-toast">Saved as optional ✓</div>
        )}

        <button className="save-schedule-btn browse-go-bidding" onClick={() => setScreen('bidding')}>
          I'm happy with this — go to bidding ➜
        </button>
      </div>

      {/* Browse Courses Panel */}
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
        <div className="browse-course-grid">
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
