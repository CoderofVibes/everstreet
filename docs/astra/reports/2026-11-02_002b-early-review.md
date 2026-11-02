# Guided authoring: early integration review

Astra, November 2. The builder is still implementing 002b. Recheck these findings against
its completed code/report before opening a correction job; no claim that this is its final
implementation. Probes used the actual new AnthropicProvider with an injected transport,
no credentials, network generation or provider spend.

## 1. Current model defaults conflict with the response parser

The current request omits `thinking`, while the parser requires exactly one text block.
An injected response with an empty `thinking` block plus one text block yields a final usage
receipt, then fails with "unexpected content". Current official docs say both selected 5.5
models enable adaptive thinking by default. For the intended no-thinking, no-tools path,
Sonnet 5.5 uses `between_tools`; Haiku 5.5 accepts `disabled`, at supported effort levels.
Set model-specific request options explicitly, include them in token counting and identity,
and test documented response shapes. Alternatively support the chosen thinking mode while
discarding private thinking content and accounting for all output tokens; do not call that
mode disabled or expose reasoning in the work log.

Sources checked by Astra: [Sonnet overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview),
[thinking configuration](https://platform.claude.com/docs/en/build-with-claude/thinking).

## 2. Actual usage may cross the pinned pricing tier

An injected Haiku response with an estimated 94,000 input tokens, actual 100,001 input and
1,000 output passes preflight and emits `usage_final` at the lower declared price, followed
by output. The worker may reject excess tokens, but the receipt has already claimed complete
cost under the wrong tier. Current pricing raises both token rates above 100,000 input tokens.
For this example, lower-tier computed spend is $0.0105001 versus $0.0525005 at the documented
higher tier. A 5% preflight margin is not proof of the final billing band.

Before issuing a final cost receipt, verify actual usage is within the supported pricing
band. Either implement the pinned tier schedule and corresponding reservations correctly,
or retain unresolved usage and refuse output when it crosses an unsupported band. Known
usage still needs accounting; do not silently price the excess at the lower tier.
Source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

## 3. Nonbillable preflight consumes unresolved budget

Independently reproduced through the actual API/Builds/BuildWorker with an injected adapter:
return `input_tokens: 999999` from the count endpoint. The only transport path called is
`/v1/messages/count_tokens`; no generation is attempted. The job fails with usage `unknown`,
retains an 11-cent reservation, and requires an uncertain-spend acknowledgement to retry.
The worker records dispatch before the adapter's free count call. Provide a trustworthy
pre-generation failure signal; a generation with an ambiguous outcome must still keep its
reservation. A founder should not exhaust budget by trying an input that preflight refuses.
Source: [token counting pricing](https://platform.claude.com/docs/en/build-with-claude/token-counting).

These are integration findings and expected correction directions, not live-provider tests.

## Corrections independently repeated

Claude addressed all three during 002b at `a6340f4`, before finishing the UI. Astra reran
the same probes successfully: the thinking response is accepted while its thinking content
is discarded; model-specific request settings are explicit; tier-crossing usage is provisional
and produces no output/final receipt; a rejected count-only request releases its reservation
and no longer demands an uncertain-spend acknowledgement. Live-provider evidence is pending.
