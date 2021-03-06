import {Injectable} from '@angular/core';
import {Worklog, WorklogDay, WorklogTask, WorklogWeek} from './worklog.model';
import {dedupeByKey} from '../../util/de-dupe-by-key';
import {PersistenceService} from '../../core/persistence/persistence.service';
import {ProjectService} from '../project/project.service';
import {BehaviorSubject, combineLatest, Observable} from 'rxjs';
import {map, switchMap, tap} from 'rxjs/operators';
import {getWeekNumber} from '../../util/get-week-number';
import {WorkContextService} from '../work-context/work-context.service';
import {WorkContext, WorkContextType} from '../work-context/work-context.model';
import {Dictionary, EntityState} from '@ngrx/entity';
import {Task} from '../tasks/task.model';
import {mapArchiveToWorklog} from './map-archive-to-worklog';
import {TaskService} from '../tasks/task.service';

const EMPTY_ENTITY = {
  ids: [],
  entities: {},
};

@Injectable({
  providedIn: 'root'
})
export class WorklogService {
  // treated as private but needs to be assigned first
  _archiveUpdateTrigger$ = new BehaviorSubject(true);

  // NOTE: task updates are not reflected
  worklogData$: Observable<{ worklog: Worklog; totalTimeSpent: number }> = combineLatest([
    this._workContextService.activeWorkContext$,
    this._archiveUpdateTrigger$,
  ]).pipe(
    switchMap(([curCtx]) => {
      return this._loadForWorkContext(curCtx);
    }),
  );

  /** @deprecated */
  worklog: Worklog;
  worklog$: Observable<Worklog> = this.worklogData$.pipe(map(data => data.worklog));
  totalTimeSpent$: Observable<number> = this.worklogData$.pipe(map(data => data.totalTimeSpent));
  currentWeek$: Observable<WorklogWeek> = this.worklog$.pipe(
    map(worklog => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const weekNr = getWeekNumber(now);

      if (worklog[year] && worklog[year].ent[month]) {
        return worklog[year].ent[month].weeks.find(week => week.weekNr === weekNr);
      }
    }),
  );

  worklogTasks$: Observable<WorklogTask[]> = this.worklog$.pipe(
    map(worklog => {
      let tasks: WorklogTask[] = [];

      Object.keys(worklog).forEach((yearKeyIN) => {
        const yearKey = +yearKeyIN;
        const year = worklog[yearKey];

        if (year && year.ent) {
          Object.keys(year.ent).forEach(monthKeyIN => {
            // needs de-normalization
            const monthKey = +monthKeyIN;
            const month = year.ent[monthKey];

            if (month && month.ent) {
              Object.keys(month.ent).forEach(dayKeyIN => {
                const dayKey = +dayKeyIN;
                const day: WorklogDay = month.ent[dayKey];
                if (day) {
                  tasks = tasks.concat(this._createTasksForDay(day));
                }
              });
            }
          });
        }
      });
      return tasks;
    })
  );

  constructor(
    private readonly _persistenceService: PersistenceService,
    private readonly _workContextService: WorkContextService,
    private readonly _projectService: ProjectService,
    private readonly _taskService: TaskService,
  ) {
    // TODO not cool
    // this.worklog$.subscribe(worklog => this.worklog = worklog);
  }


  refreshWorklog() {
    this._archiveUpdateTrigger$.next(true);
  }

  // TODO this is not waiting for worklog data
  getTaskListForRange$(rangeStart: Date, rangeEnd: Date, isFilterOutTimeSpentOnOtherDays = false): Observable<WorklogTask[]> {
    return this.worklogTasks$.pipe(
      map(tasks => {
        tasks = tasks.filter((task) => {
          const taskDate = new Date(task.dateStr);
          return (taskDate >= rangeStart && taskDate <= rangeEnd);
        });

        if (isFilterOutTimeSpentOnOtherDays) {
          tasks = tasks.map((task): WorklogTask => {

            const timeSpentOnDay = {};
            Object.keys(task.timeSpentOnDay).forEach(dateStr => {
              const date = new Date(dateStr);

              if (date >= rangeStart && date <= rangeEnd) {
                timeSpentOnDay[dateStr] = task.timeSpentOnDay[dateStr];
              }
            });

            return {
              ...task,
              timeSpentOnDay
            };
          });
        }

        return dedupeByKey(tasks, 'id');
      }),
    );
  }


  private async _loadForWorkContext(workContext: WorkContext): Promise<{ worklog: Worklog; totalTimeSpent: number }> {
    const archive = await this._persistenceService.taskArchive.loadState() || EMPTY_ENTITY;
    const taskState = await this._persistenceService.task.loadState() || EMPTY_ENTITY;
    // const taskState = await this._taskService.taskFeatureState$.toPromise() || EMPTY_ENTITY;

    const {completeStateForWorkContext, unarchivedIds} = this._getCompleteStateForWorkContext(workContext, taskState, archive);

    const startEnd = {
      workStart: workContext.workStart,
      workEnd: workContext.workEnd,
    };


    if (completeStateForWorkContext) {
      const {worklog, totalTimeSpent} = mapArchiveToWorklog(completeStateForWorkContext, unarchivedIds, startEnd);
      return {
        worklog,
        totalTimeSpent,
      };
    }
    return {
      worklog: {},
      totalTimeSpent: null
    };
  }

  private _limitStateToIds(stateIn: EntityState<Task>, ids: string[]): Dictionary<Task> {
    return ids.reduce((acc, id) => ({
      ...acc,
      [id]: stateIn.entities[id]
    }), {});
  }

  private _getCompleteStateForWorkContext(workContext: WorkContext, taskState: EntityState<Task>, archive: EntityState<Task>): {
    completeStateForWorkContext: EntityState<Task>,
    unarchivedIds: string[]
  } {
    const filterIdsForProject = (state: EntityState<Task>): string[] => (state.ids as string[]).filter(
      id => state.entities[id].projectId === workContext.id
    );
    const filterIdsForTag = (state: EntityState<Task>): string[] => (state.ids as string[]).filter(
      id => state.entities[id].tagIds.includes(workContext.id)
    );

    const unarchivedIds: string[] = (workContext.type === WorkContextType.TAG)
      ? filterIdsForTag(taskState)
      : filterIdsForProject(taskState);
    const archivedIdsForTag: string[] = (workContext.type === WorkContextType.TAG)
      ? filterIdsForTag(archive)
      : filterIdsForProject(archive);


    return {
      completeStateForWorkContext: {
        ids: [...unarchivedIds, ...archivedIdsForTag],
        entities: {
          ...this._limitStateToIds(taskState, unarchivedIds),
          ...this._limitStateToIds(archive, archivedIdsForTag),
        },
      },
      unarchivedIds,
    };
  }

  private _createTasksForDay(data: WorklogDay): WorklogTask[] {
    const dayData = {...data};

    return dayData.logEntries.map((entry) => {
      return {
        ...entry.task,
        timeSpent: entry.timeSpent,
        dateStr: dayData.dateStr,
      };
    });
  }
}
