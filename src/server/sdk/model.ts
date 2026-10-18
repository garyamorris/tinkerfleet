/**
 * Wrap the real model so every call checks the run's budget and cancellation first,
 * and reports token usage and hosted web-search activity as it goes.
 */
import { Usage, type Model, type ModelResponse } from '@openai/agents';
import type { AgentId } from '../../shared/types.js';
import { modelInputChars, trimModelRequest } from '../context-budget.js';
import { parseAction } from './actions.js';
import type { SdkEvent, SdkLimits } from './contract.js';
import { SafeSdkError, safeExecutionFailure, safeModelFailure } from './errors.js';
import { responseSources } from './response-sources.js';
import { assertActive, clone, type PrivateRun } from './run-state.js';
import { summarizeCall, type TraceStore } from './trace.js';

export interface ModelContext {
  limits: SdkLimits;
  webSearchEnabled: boolean;
  streamWebActivity: boolean;
  workspaceRoot?: string;
  resolveModel: () => Promise<Model>;
  emit: (run: PrivateRun, event: Omit<SdkEvent, 'runId' | 'at'>) => void;
  /** When set, every model call is summarized here so the trace viewer can show it. */
  trace?: TraceStore;
}

export function guardedModel(
  run: PrivateRun,
  role: AgentId | undefined,
  context: ModelContext,
): Model {
  const { limits, webSearchEnabled, streamWebActivity, workspaceRoot, resolveModel, emit, trace } =
    context;
  const checkBudget = () => {
    assertActive(run);
    if (limits.maxModelCalls > 0 && run.view.usage.modelCalls >= limits.maxModelCalls)
      throw new SafeSdkError('Model-call limit reached.');
    if (run.view.usage.totalTokens >= limits.maxTotalTokens)
      throw new SafeSdkError(
        'This Tinkerfleet run reached its local token budget. Send a follow-up message to continue with a fresh run budget, or raise TINKERFLEET_MAX_TOTAL_TOKENS. This is not an API quota error.',
      );
    run.view.usage.modelCalls += 1;
  };
  return {
    async getResponse(incoming) {
      const trimmed = trimModelRequest(incoming, { maxInputChars: limits.maxInputChars });
      const outgoing = trimmed.request;
      checkBudget();
      const model = await resolveModel();
      assertActive(run);
      const request = {
        ...outgoing,
        ...(webSearchEnabled
          ? {
              modelSettings: {
                ...outgoing.modelSettings,
                providerData: {
                  ...outgoing.modelSettings.providerData,
                  include: ['web_search_call.action.sources'],
                },
              },
            }
          : {}),
        signal: run.controller.signal,
      };
      const startedWebCalls = new Set<string>(),
        finishedWebCalls = new Set<string>();
      const readResponse = async (): Promise<ModelResponse> => {
        if (!webSearchEnabled || !streamWebActivity || !role) return model.getResponse(request);
        let completed: ModelResponse | undefined;
        for await (const event of model.getStreamedResponse(request)) {
          assertActive(run);
          if (event.type === 'response_done') {
            if (completed)
              throw new SafeSdkError(
                'The model returned more than one final response. No further action was taken.',
              );
            completed = {
              responseId: event.response.id,
              requestId: event.response.requestId,
              output: event.response.output,
              usage: new Usage(event.response.usage),
              providerData: event.response.providerData,
            };
          } else if (event.type === 'model') {
            // Inspect only allowlisted lifecycle fields. Raw provider text/reasoning is never emitted.
            const raw = event.event as { type?: unknown; item_id?: unknown } | null;
            if (!raw || typeof raw.item_id !== 'string' || !raw.item_id || raw.item_id.length > 256)
              continue;
            if (
              raw.type === 'response.web_search_call.in_progress' ||
              raw.type === 'response.web_search_call.searching'
            ) {
              if (!startedWebCalls.has(raw.item_id) && !finishedWebCalls.has(raw.item_id)) {
                startedWebCalls.add(raw.item_id);
                emit(run, { type: 'tool_started', agent: role, tool: 'web_search' });
              }
            } else if (
              raw.type === 'response.web_search_call.completed' &&
              !finishedWebCalls.has(raw.item_id)
            ) {
              finishedWebCalls.add(raw.item_id);
              emit(run, { type: 'tool_finished', agent: role, tool: 'web_search' });
            }
          }
        }
        if (!completed)
          throw new SafeSdkError(
            'The model stream ended before a final response arrived. No further action was taken.',
          );
        return completed;
      };
      const startedAt = Date.now();
      // Tracing is an aid for readers: whatever goes wrong while recording must not change the run.
      const recordCall = (outcome: { response?: ModelResponse; error?: string }) => {
        try {
          trace?.record(
            run.view.runId,
            summarizeCall({
              agent: role ?? 'coordinator',
              startedAt,
              durationMs: Date.now() - startedAt,
              request: outgoing,
              charsBefore: modelInputChars(incoming),
              charsSent: trimmed.inputChars,
              budget: limits.maxInputChars,
              removedItems: trimmed.removedItems,
              trimmedToolOutputs: trimmed.trimmedToolOutputs,
              ...outcome,
            }),
          );
        } catch {
          /* The trace is optional. */
        }
      };
      const response = await readResponse().catch((error) => {
        const failure = safeModelFailure(error);
        recordCall({
          error: safeExecutionFailure(failure) ?? 'The model call failed.',
        });
        throw failure;
      });
      recordCall({ response });
      assertActive(run);
      run.view.usage.inputTokens += response.usage.inputTokens;
      run.view.usage.outputTokens += response.usage.outputTokens;
      run.view.usage.totalTokens += response.usage.totalTokens;
      if (webSearchEnabled && role) {
        run.sourceMessages.set(role, responseSources(response.output));
        // Fallback for providers without streamed lifecycle details. Never fabricate a start.
        for (const item of response.output) {
          if (
            item.type === 'hosted_tool_call' &&
            item.name === 'web_search_call' &&
            item.status === 'completed' &&
            !(item.id && finishedWebCalls.has(item.id))
          ) {
            const action = item.providerData?.action?.type;
            const tool =
              action === 'open_page'
                ? 'web_open_page'
                : action === 'find_in_page'
                  ? 'web_find_in_page'
                  : 'web_search';
            emit(run, { type: 'tool_finished', agent: role, tool });
          }
        }
      }
      emit(run, { type: 'usage', usage: clone(run.view.usage) });
      // Reject malformed approval-bound requests before SDK recovery can make another model call.
      for (const item of response.output)
        if (
          item.type === 'function_call' &&
          (item.name === 'run_command' || item.name === 'edit_file')
        )
          parseAction(item.name, item.arguments, workspaceRoot);
      if (
        run.view.usage.totalTokens >= limits.maxTotalTokens &&
        response.output.some((item) => item.type === 'function_call')
      )
        throw new SafeSdkError(
          'This Tinkerfleet run reached its local token budget before starting more work. Send a follow-up message to continue with a fresh run budget, or raise TINKERFLEET_MAX_TOTAL_TOKENS. This is not an API quota error.',
        );
      return response;
    },
    async *getStreamedResponse() {
      // This adapter uses lifecycle events, not raw provider streams or reasoning.
      throw new SafeSdkError('Raw model streaming is disabled in this adapter.');
    },
  };
}
