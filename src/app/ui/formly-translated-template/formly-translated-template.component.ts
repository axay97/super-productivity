import {ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {FieldType} from '@ngx-formly/core';
import {Subscription} from 'rxjs';
import {TranslateService} from '@ngx-translate/core';

@Component({
  selector: 'formly-translated-template',
  templateUrl: './formly-translated-template.component.html',
  styleUrls: ['./formly-translated-template.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FormlyTranslatedTemplateComponent extends FieldType implements OnInit, OnDestroy {

  @ViewChild('tplWrapper', {static: true}) tplWrapper: ElementRef;

  private _el: HTMLElement;
  private _subs = new Subscription();

  constructor(
    private _translateService: TranslateService,
  ) {
    super();
  }

  ngOnInit(): void {
    this._createTag();
    const translationId = this.field.templateOptions.text;
    if (!translationId) {
      console.warn('No translation id provided');
      return;
    }

    this._subs.add(this._translateService.stream(translationId).subscribe((translationString) => {
      this._el.innerHTML = translationString;
    }));
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  private _createTag() {
    const tag = this.field.templateOptions.tag || 'div';
    const tplWrapperEl = this.tplWrapper.nativeElement;

    if (tplWrapperEl) {
      this._el = document.createElement(tag);

      if (this.field.templateOptions.class) {
        this._el.classList.add(this.field.templateOptions.class);
      }

      this.tplWrapper.nativeElement.append(this._el);
    }
  }
}
