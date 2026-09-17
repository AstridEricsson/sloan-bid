import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../context/AppContext';
import type { Course } from '../types';
import { StarRating } from '../components/StarRating';

// Droppable column
function DroppableColumn({
  id,
  title,
  courses,
  color,
  emptyLabel,
  activeId,
}: {
  id: string;
  title: string;
  courses: Course[];
  color: string;
  emptyLabel: string;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`droppable-column ${isOver ? 'over' : ''} col-${color}`}
    >
      <div className="column-header">
        <div className={`column-dot dot-${color}`} />
        <h2 className="column-title">{title}</h2>
        <span className="column-count">{courses.length}</span>
      </div>
      <SortableContext items={courses.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="column-body">
          {courses.length === 0 && (
            <div className="column-empty">
              <span>{emptyLabel}</span>
            </div>
          )}
          {courses.map((course) => (
            <SortableCard key={course.id} course={course} isDragging={activeId === course.id} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

// Draggable card (standard size)
function SortableCard({ course, isDragging }: { course: Course; isDragging: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({
    id: course.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <MiniCourseCard course={course} />
    </div>
  );
}


function MiniCourseCard({ course, overlay }: { course: Course; overlay?: boolean }) {
  return (
    <div className={`mini-card ${overlay ? 'overlay' : ''} ${course.isObligatory ? 'mini-card-obligatory' : ''}`}>
      <div className="mini-card-top">
        <span className="mini-card-number">
          {course.number}
          <span className={`term-badge term-${course.term.toLowerCase()}`}>{course.term} · {course.units}u</span>
        </span>
        {course.isObligatory ? (
          <span className="mini-card-lock">SFMBA Obligatory</span>
        ) : (
          <span className="mini-card-grip">⋮⋮</span>
        )}
      </div>
      <div className="mini-card-title">{course.title}</div>
      <div className="mini-card-prof">{course.professor}</div>
      <StarRating rating={course.rating} size="sm" />
    </div>
  );
}


// Unassigned pool — courses added but not put in Need-to-Have. These are
// remembered and can be added to the schedule later.
function UnassignedPool({
  courses,
  activeId,
}: {
  courses: Course[];
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unassigned' });
  return (
    <div className="unassigned-section">
      <h3 className="unassigned-title">Added Courses — drag to categorize</h3>
      <p className="unassigned-subtitle">
        The courses you leave here are remembered and you'll be able to add them at a later stage.
      </p>
      <SortableContext items={courses.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`unassigned-pool ${isOver ? 'over' : ''} ${courses.length === 0 ? 'pool-empty' : ''}`}
        >
          {courses.length === 0 && (
            <span className="pool-empty-label">
              All courses categorized ✓
            </span>
          )}
          {courses.map((c) => (
            <SortableCard key={c.id} course={c} isDragging={activeId === c.id} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}


type Container = 'need' | 'nice' | 'optional' | 'unassigned';

export function PrioritizeScreen() {
  const {
    addedCourses,
    needToHave,
    niceToHave,
    optional,
    setNeedToHave,
    setNiceToHave,
    setOptional,
    setScreen,
  } = useApp();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [obligatoryWarning, setObligatoryWarning] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Courses in the unassigned pool: added but not yet placed in any tier.
  // A course stays in whichever tier it was dropped into until the user
  // drags it somewhere else — it is never silently reassigned.
  const tieredIds = new Set([...needToHave, ...niceToHave, ...optional].map((c) => c.id));
  const unassigned = addedCourses.filter((c) => !tieredIds.has(c.id));

  const listByContainer: Record<Container, Course[]> = {
    need: needToHave,
    nice: niceToHave,
    optional,
    unassigned,
  };

  const setterByContainer: Record<Container, (courses: Course[]) => void> = {
    need: setNeedToHave,
    nice: setNiceToHave,
    optional: setOptional,
    unassigned: () => {}, // unassigned is derived, not stored directly
  };

  const findContainer = (id: string): Container | null => {
    if (needToHave.find((c) => c.id === id)) return 'need';
    if (niceToHave.find((c) => c.id === id)) return 'nice';
    if (optional.find((c) => c.id === id)) return 'optional';
    if (unassigned.find((c) => c.id === id)) return 'unassigned';
    return null;
  };

  const getList = (container: Container): Course[] => listByContainer[container];

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;

    const activeContainer = findContainer(String(active.id));
    if (!activeContainer) return;

    // Block moving obligatory courses out of need-to-have
    const draggedCourse = [...needToHave, ...niceToHave, ...optional, ...unassigned].find(
      (c) => c.id === String(active.id)
    );
    let overContainer: Container;
    if (over.id === 'need' || over.id === 'nice' || over.id === 'optional' || over.id === 'unassigned') {
      overContainer = over.id as Container;
    } else {
      overContainer = findContainer(String(over.id)) || activeContainer;
    }

    if (draggedCourse?.isObligatory && overContainer !== 'need') {
      setObligatoryWarning(true);
      setTimeout(() => setObligatoryWarning(false), 5000);
      return;
    }

    const activeList = getList(activeContainer);
    const overList = getList(overContainer);
    const activeIdx = activeList.findIndex((c) => c.id === String(active.id));
    const overIdx = overList.findIndex((c) => c.id === String(over.id));

    if (activeContainer === overContainer) {
      // Reorder within same list
      const newList = arrayMove(activeList, activeIdx, overIdx >= 0 ? overIdx : activeList.length - 1);
      setterByContainer[activeContainer](newList);
    } else {
      // Move between lists
      const item = activeList[activeIdx];
      if (!item) return;

      const newActiveList = activeList.filter((_, i) => i !== activeIdx);
      const insertAt = overIdx >= 0 ? overIdx : overList.length;
      const newOverList = [...overList.slice(0, insertAt), item, ...overList.slice(insertAt)];

      // Update source, then destination — the course only ever lives in one
      // tier's state array at a time, so the schedule always recomputes off
      // a single source of truth for where each course currently sits.
      setterByContainer[activeContainer](newActiveList);
      setterByContainer[overContainer](newOverList);
    }
  };

  const activeCourse = activeId
    ? [...needToHave, ...niceToHave, ...optional, ...unassigned].find((c) => c.id === activeId)
    : null;

  return (
    <div className="screen prioritize-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Prioritize</h1>
          <p className="screen-subtitle">
            Drag courses into Need-to-Have, Nice-to-Have, or Optional to structure your priorities.
          </p>
        </div>
        {needToHave.length > 0 && (
          <button className="cta-btn" onClick={() => setScreen('schedule')}>
            Build Schedule →
          </button>
        )}
      </div>

      {addedCourses.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⊟</div>
          <p>You haven't added any courses yet.</p>
          <button onClick={() => setScreen('discover')}>Browse courses →</button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="prioritize-layout">
            {/* Unassigned Pool */}
            <UnassignedPool courses={unassigned} activeId={activeId} />

            <div className="tier-columns">
              <DroppableColumn
                id="need"
                title="Need-to-Have"
                courses={needToHave}
                color="need"
                emptyLabel="Drop courses here to add them to your schedule"
                activeId={activeId}
              />
              <DroppableColumn
                id="nice"
                title="Nice-to-Have"
                courses={niceToHave}
                color="nice"
                emptyLabel="Drop courses here if they'd be great to fit in"
                activeId={activeId}
              />
              <DroppableColumn
                id="optional"
                title="Optional"
                courses={optional}
                color="optional"
                emptyLabel="Drop courses here to consider only if there's space"
                activeId={activeId}
              />
            </div>
          </div>

          <DragOverlay>
            {activeCourse && <MiniCourseCard course={activeCourse} overlay />}
          </DragOverlay>
        </DndContext>
      )}

      {/* Obligatory warning toast */}
      {obligatoryWarning && (
        <div className="obligatory-toast">
          This course is obligatory for your program and must stay in Need-to-Have.
        </div>
      )}

      {/* Course Info Panel */}
      {selectedCourse && (
        <div className="course-info-panel">
          <div className="panel-header">
            <div>
              <span className="panel-number">{selectedCourse.number}</span>
              <h3 className="panel-title">{selectedCourse.title}</h3>
            </div>
            <button className="panel-close" onClick={() => setSelectedCourse(null)}>✕</button>
          </div>
          <p className="panel-prof">{selectedCourse.professor}</p>
          <StarRating rating={selectedCourse.rating} />
          <p className="panel-quote">"{selectedCourse.reviewQuote}"</p>
          <div className="panel-sections">
            <h4>Sections</h4>
            {selectedCourse.sections.map((s) => (
              <div key={s.id} className="panel-section-row">
                <span>{s.days}</span>
                <span>{s.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
