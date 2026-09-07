import json
import unittest
from simkind_reader import ROOT, read_document


class ReaderTests(unittest.TestCase):
    def test_six_document_fixtures(self):
        root = ROOT / 'fixtures/format/draft.2'
        cases = json.loads((root / 'cases.json').read_text())
        for case in cases:
            with self.subTest(case=case['id']):
                source = (root / case['input']).read_text()
                result = read_document(source)
                self.assertEqual(result['kind'], case['expectedKind'])
                self.assertEqual(result, json.loads(source))
                self.assertEqual(read_document(json.dumps(result)), result)

    def test_markdown_body_presence_and_extension_preservation(self):
        doc = {'specVersion': '0.2.0-draft.2', 'kind': 'character', 'id': 'character:test', 'name': 'Test',
               'profiles': {'vendor.test': {'version': '1', 'required': False}}, 'extensions': {'vendor.test': {'opaque': ['hello', 3]}}}
        source = '```simkind\n' + json.dumps(doc) + '\n```'
        self.assertEqual(read_document(source, True), doc)
        self.assertEqual(read_document(source + '\n', True)['persona']['description'], '')
        self.assertEqual(read_document(source + '\nHello\n', True)['persona']['description'], 'Hello\n')

    def test_strict_negative_boundaries(self):
        for source in ['{"a":1,"\\u0061":2}', '{"value":NaN}', '[' * 65 + '0' + ']' * 65,
                       '{"specVersion":"0.2.0-draft.2","kind":"character","id":"a","name":"A","typo":true}']:
            with self.subTest(source=source[:30]), self.assertRaises(ValueError):
                read_document(source)


if __name__ == '__main__':
    unittest.main()
