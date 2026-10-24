"""What design.needle_profile() gives: tf.needleProfile()'s answer as named
tuples of its fields, and a candidate as design.insert_needle() passes it
back."""

import collections

NeedleProfile = collections.namedtuple("NeedleProfile", "mode mf0 candidates")
NeedleCandidate = collections.namedtuple("NeedleCandidate", "material kind layer position fraction depth gradient")


def needle_profile_of(answer):
    """tf.needleProfile()'s answer `answer` as a NeedleProfile of NeedleCandidates."""
    return NeedleProfile(answer["mode"], answer["mf0"], [NeedleCandidate(**found) for found in answer["candidates"]])


def candidate_argument(candidate):
    """`candidate`, a NeedleCandidate or a dict of its fields, as the API takes it."""
    return dict(candidate._asdict()) if isinstance(candidate, NeedleCandidate) else candidate
