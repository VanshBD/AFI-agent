"""Static guardrails for the reviewed, allowlisted relationship-read query."""
from pathlib import Path


source = Path("tigergraph/queries/get_transaction_relationship_context.gsql").read_text(encoding="utf-8")

assert "CREATE OR REPLACE QUERY getTransactionRelationshipContext" in source
assert "FOR GRAPH FraudCommand SYNTAX v2" in source
assert "INSTALL QUERY -FORCE getTransactionRelationshipContext" in source
assert "IF txn.occurred_at <= cutoff THEN" in source
assert "-(FROM_DEVICE>:e)- DeviceProfile:d LIMIT 20" in source
assert "-(PURCHASER_EMAIL>:e)- EmailDomain:d LIMIT 20" in source
assert "-(RECIPIENT_EMAIL>:e)- EmailDomain:d LIMIT 20" in source
assert "-(BILLED_IN>:e)- BillingRegion:b LIMIT 20" in source
assert "-(<INVOLVES:e)- ClosedCase:c" in source
assert "WHERE c.closed_at < cutoff LIMIT 20" in source
assert "-(ON_KNOWN_CARD>:e)- KnownCard:k LIMIT 20" in source
assert "KnownCards AS known_cards" in source
for forbidden in ("INSERT INTO", "UPDATE ", "DELETE ", "DROP ", "CREATE VERTEX", "CREATE EDGE"):
    assert forbidden not in source, forbidden

# Test findRelatedCases query source guardrails
source_cases = Path("tigergraph/queries/find_related_cases.gsql").read_text(encoding="utf-8")
assert "CREATE OR REPLACE QUERY findRelatedCases" in source_cases
assert "FOR GRAPH FraudCommand SYNTAX v2" in source_cases
assert "INSTALL QUERY -FORCE findRelatedCases" in source_cases
assert "IF txn.occurred_at <= cutoff THEN" in source_cases
assert "-(<INVOLVES:e)- ClosedCase:c" in source_cases
assert "WHERE c.closed_at < cutoff LIMIT 20" in source_cases
assert "-(ON_KNOWN_CARD>:e)- KnownCard:k LIMIT 20" in source_cases
assert "-(CLASSIFIED_AS>:e)- FraudPattern:p LIMIT 20" in source_cases
assert "EligibleCases AS eligible_closed_cases" in source_cases
for forbidden in ("INSERT INTO", "UPDATE ", "DELETE ", "DROP ", "CREATE VERTEX", "CREATE EDGE"):
    assert forbidden not in source_cases, forbidden

print("tigergraph relationship query source tests passed")

