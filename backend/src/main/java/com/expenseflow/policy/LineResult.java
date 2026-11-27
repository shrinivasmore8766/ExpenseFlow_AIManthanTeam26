package com.expenseflow.policy;

import java.util.List;

/** Policy result for one line: the most severe outcome plus every rule hit. */
public record LineResult(Outcome outcome, List<RuleHit> hits) {
}
