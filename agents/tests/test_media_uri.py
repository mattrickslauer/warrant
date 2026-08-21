"""A gs:// reference becomes a URI part, and a local file still becomes bytes.

The fleet judges photographs that live in Cloud Storage. Inflating megabytes into base64
through the query payload would be the obvious way to do that and the wrong one, so a media
reference may name an object instead of carrying it.
"""
import pytest

from warrant.base import Agent, MediaMissing


def test_gs_reference_becomes_a_uri_part():
    part = Agent.media("gs://warrent-505918-evidence/captures/cap_1.jpg")
    assert part.uri == "gs://warrent-505918-evidence/captures/cap_1.jpg"
    assert part.mime_type == "image/jpeg"
    assert part.data is None


def test_uri_part_digests_its_uri_not_its_bytes():
    """The cassette key is built from attachment bytes, which a URI part does not have."""
    a = Agent.media("gs://b/one.jpg")
    b = Agent.media("gs://b/one.jpg")
    c = Agent.media("gs://b/two.jpg")
    assert a.digest() == b.digest()
    assert a.digest() != c.digest()


def test_unsupported_extension_on_a_uri_is_refused():
    """An Inspector asked to judge something it cannot decode would answer anyway."""
    with pytest.raises(MediaMissing):
        Agent.media("gs://b/notes.txt")


def test_local_files_are_unchanged():
    """The eval corpus keeps using local media, and its cassettes must not move."""
    part = Agent.media("brake/pads-seated-sharp.jpg")
    assert part.uri is None
    assert part.data is not None


def test_a_local_file_digest_is_unaffected_by_the_uri_branch():
    """The whole eval corpus is keyed on this. If it moves, every cassette misses."""
    part = Agent.media("brake/pads-seated-sharp.jpg")
    assert part.digest().startswith("m:image/jpeg:")
