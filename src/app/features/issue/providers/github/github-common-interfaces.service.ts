import {Injectable} from '@angular/core';
import {Observable, of} from 'rxjs';
import {Task} from 'src/app/features/tasks/task.model';
import {catchError, concatMap, first, map, switchMap} from 'rxjs/operators';
import {IssueServiceInterface} from '../../issue-service-interface';
import {GithubApiService} from './github-api.service';
import {ProjectService} from '../../../project/project.service';
import {SearchResultItem} from '../../issue.model';
import {GithubCfg} from './github.model';
import {SnackService} from '../../../../core/snack/snack.service';
import {GithubIssue, GithubIssueReduced} from './github-issue/github-issue.model';
import {truncate} from '../../../../util/truncate';
import {T} from '../../../../t.const';


@Injectable({
  providedIn: 'root',
})
export class GithubCommonInterfacesService implements IssueServiceInterface {
  constructor(
    private readonly _githubApiService: GithubApiService,
    private readonly _projectService: ProjectService,
    private readonly _snackService: SnackService,
  ) {
  }

  issueLink$(issueId: number, projectId: string): Observable<string> {
    return this._getCfgOnce$(projectId).pipe(
      map((cfg) => `https://github.com/${cfg.repo}/issues/${issueId}`)
    );
  }

  getById$(issueId: number, projectId: string) {
    return this._getCfgOnce$(projectId).pipe(
      concatMap(githubCfg => this._githubApiService.getById$(issueId, githubCfg))
    );
  }

  searchIssues$(searchTerm: string, projectId: string): Observable<SearchResultItem[]> {
    return this._getCfgOnce$(projectId).pipe(
      switchMap((githubCfg) => (githubCfg && githubCfg.isSearchIssuesFromGithub)
        ? this._githubApiService.searchIssueForRepo$(searchTerm, githubCfg).pipe(catchError(() => []))
        : of([])
      )
    );
  }

  async refreshIssue(
    task: Task,
    isNotifySuccess = true,
    isNotifyNoUpdateRequired = false,
  ): Promise<{ taskChanges: Partial<Task>, issue: GithubIssue }> {
    const cfg = await this._getCfgOnce$(task.projectId).toPromise();
    const issue = await this._githubApiService.getById$(+task.issueId, cfg).toPromise();

    const issueUpdate: number = new Date(issue.updated_at).getTime();
    const commentsByOthers = (cfg.filterUsername && cfg.filterUsername.length > 1)
      ? issue.comments.filter(comment => comment.user.login !== cfg.filterUsername)
      : issue.comments;

    // TODO: we also need to handle the case when the user himself updated the issue, to also update the issue...
    const updates: number[] = [
      ...(commentsByOthers.map(comment => new Date(comment.created_at).getTime())),
      issueUpdate
    ].sort();
    const lastRemoteUpdate = updates[updates.length - 1];

    const wasUpdated = lastRemoteUpdate > (task.issueLastUpdated || 0);

    if (wasUpdated && isNotifySuccess) {
      this._snackService.open({
        ico: 'cloud_download',
        translateParams: {
          issueText: this._formatIssueTitleForSnack(issue.number, issue.title)
        },
        msg: T.F.GITHUB.S.ISSUE_UPDATE,
      });
    } else if (isNotifyNoUpdateRequired) {
      this._snackService.open({
        msg: T.F.GITHUB.S.ISSUE_NO_UPDATE_REQUIRED,
        ico: 'cloud_download',
      });
    }

    if (wasUpdated) {
      return {
        taskChanges: {
          issueWasUpdated: true,
          issueLastUpdated: lastRemoteUpdate,
          title: `#${issue.number} ${issue.title}`,
        },
        issue,
      };
    }
  }

  getAddTaskData(issue: GithubIssueReduced): { title: string; additionalFields: Partial<Task> } {
    return {
      title: this._formatIssueTitle(issue.number, issue.title),
      additionalFields: {
        // issueWasUpdated: false,
        // NOTE: we use Date.now() instead to because updated does not account for comments
        // issueLastUpdated: new Date(issue.updated_at).getTime()
      }
    };
  }

  private _formatIssueTitle(id: number, title: string): string {
    return `#${id} ${title}`;
  }

  private _formatIssueTitleForSnack(id: number, title: string): string {
    return `${truncate(this._formatIssueTitle(id, title))}`;
  }

  private _getCfgOnce$(projectId: string): Observable<GithubCfg> {
    return this._projectService.getGithubCfgForProject$(projectId).pipe(first());
  }
}
