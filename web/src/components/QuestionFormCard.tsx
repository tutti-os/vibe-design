import React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from '@tutti-os/ui-system/components';
import { GuideIcon } from '@tutti-os/ui-system/icons';
import {
  formatQuestionFormAnswers,
  initialQuestionFormAnswers,
  parseSubmittedQuestionFormAnswers,
  type QuestionFormAnswerValue,
  type QuestionFormAnswers,
  type QuestionFormDefinition,
  type QuestionFormQuestion,
} from '../runtime/question-form';
import { useTranslation } from '../i18n';

export function QuestionFormCard({
  form,
  interactive,
  nextUserContent,
  onSubmit,
  requireAllAnswers = false,
  formatSubmitContent = formatQuestionFormAnswers,
  submitErrorMessage,
}: {
  form: QuestionFormDefinition;
  interactive: boolean;
  nextUserContent?: string;
  onSubmit?: (content: string) => void | Promise<void>;
  requireAllAnswers?: boolean;
  formatSubmitContent?: (form: QuestionFormDefinition, answers: QuestionFormAnswers) => string;
  submitErrorMessage?: string;
}) {
  const { t } = useTranslation();
  const submittedAnswers = React.useMemo(
    () => parseSubmittedQuestionFormAnswers(form, nextUserContent),
    [form, nextUserContent],
  );
  const [answers, setAnswers] = React.useState<QuestionFormAnswers>(() =>
    initialQuestionFormAnswers(form, submittedAnswers ?? undefined),
  );
  const [submitted, setSubmitted] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const locked = !interactive || !onSubmit || submitted || submittedAnswers !== null;
  const currentAnswers = submittedAnswers ?? answers;
  const formTitle = form.title === 'Quick brief' ? t('questionForm.quickBrief') : form.title;
  const ready = requireAllAnswers
    ? form.questions.every((question) => hasQuestionAnswer(currentAnswers[question.id]))
    : form.questions.some((question) => hasQuestionAnswer(currentAnswers[question.id]));

  function update(questionId: string, value: QuestionFormAnswerValue): void {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function toggle(questionId: string, value: string): void {
    if (locked) return;
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId]) ? prev[questionId] as string[] : [];
      return {
        ...prev,
        [questionId]: current.includes(value)
          ? current.filter((entry) => entry !== value)
          : [...current, value],
      };
    });
  }

  async function submit(): Promise<void> {
    if (locked || !onSubmit || !ready) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(formatSubmitContent(form, answers));
      setSubmitted(true);
    } catch (submitError) {
      setError(
        submitErrorMessage ??
          (submitError instanceof Error ? submitError.message : t('questionForm.submitFailed')),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card size="sm" className="question-form-card" data-form-id={form.id}>
      <CardHeader>
        <div className="question-form-card__header">
          <CardTitle className="tool-card__title">
            <GuideIcon size={16} />
            <span>{formTitle}</span>
          </CardTitle>
          {locked ? <Badge variant="secondary">{t('questionForm.answered')}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="question-form-card__content">
        {form.questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            value={currentAnswers[question.id]}
            locked={locked || pending}
            onChange={(value) => update(question.id, value)}
            onToggle={(value) => toggle(question.id, value)}
          />
        ))}
        {error ? (
          <span className="tool-card__meta" aria-live="polite">
            {error}
          </span>
        ) : null}
      </CardContent>
      <CardFooter className="question-form-card__footer">
        <span className="tool-card__meta">
          {locked ? t('questionForm.answersLocked') : t('questionForm.submitHint')}
        </span>
        {!locked ? (
          <Button
            type="button"
            size="xs"
            disabled={pending || !ready}
            onClick={() => void submit()}
          >
            {pending ? t('questionForm.submitting') : form.submitLabel ?? t('questionForm.submit')}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function QuestionField({
  question,
  value,
  locked,
  onChange,
  onToggle,
}: {
  question: QuestionFormQuestion;
  value: QuestionFormAnswerValue | undefined;
  locked: boolean;
  onChange(value: QuestionFormAnswerValue): void;
  onToggle(value: string): void;
}) {
  const { t } = useTranslation();
  return (
    <section className="question-form-card__field">
      <label className="question-form-card__label">
        <span>{question.title}</span>
        {question.required ? <span aria-label={t('questionForm.required')}>*</span> : null}
      </label>
      {question.type === 'text' ? (
        <Input
          size="sm"
          aria-label={question.title}
          value={typeof value === 'string' ? value : ''}
          placeholder={question.placeholder}
          disabled={locked}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value)}
        />
      ) : null}
      {question.type === 'textarea' ? (
        <Textarea
          aria-label={question.title}
          value={typeof value === 'string' ? value : ''}
          placeholder={question.placeholder}
          disabled={locked}
          rows={3}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)}
        />
      ) : null}
      {question.options && question.type !== 'text' && question.type !== 'textarea' ? (
        <div className="question-form-card__options">
          {question.options.map((option) => {
            const active = isOptionActive(question, value, option.value);
            return (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={active ? 'secondary' : 'outline'}
                disabled={locked}
                className="question-form-card__option"
                aria-pressed={active}
                title={option.description}
                onClick={() => {
                  if (question.type === 'checkbox') onToggle(option.value);
                  else onChange(option.value);
                }}
              >
                <span>{option.label}</span>
                {option.description ? <span className="tool-card__meta">{option.description}</span> : null}
              </Button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function isOptionActive(
  question: QuestionFormQuestion,
  value: QuestionFormAnswerValue | undefined,
  optionValue: string,
): boolean {
  if (question.type === 'checkbox') return Array.isArray(value) && value.includes(optionValue);
  return value === optionValue;
}

function hasQuestionAnswer(value: QuestionFormAnswerValue | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0;
}
