p=Path('build-info.json'); d=json.loads(p.read_text()); d['appVersion']='0.29.7'; d['buildDate']='2026-08-31T01:55:00+07:00'; d['commit']='unavailable'; p.write_text(json.dumps(d,indent=2)+'\n')
