# STPA手順書

## 手順

1. **ロス(L)**:利害関係者にとって受け入れられない損失を2〜4個挙げる(人の負傷、設備の損傷など)。
2. **ハザード(H)**:ロスにつながるシステムの状態を挙げ、どのロスにつながるか書く。
3. **制御構造**:コントローラ(実装する制御ソフト、利用者、センサ、外部装置)と、それぞれが出す制御アクション(CA)を挙げる。
4. **UCA**:各CAに次の4分類を当て、危険になる状況(`context`)を書く。
   - `notProvided`:必要なときに提供されない
   - `providedUnsafe`:提供されると危険
   - `wrongTiming`:早すぎる、遅すぎる、順序が誤っている
   - `wrongDuration`:長すぎる継続、早すぎる停止(割り込みの後に戻らない、戻りすぎるもここ)

   該当しない分類は `notApplicable` に理由を書く。
5. **安全制約(SC)**:UCAを裏返して、実装するコントローラが守る約束にする。外部のコントローラのUCAも、実装するコントローラがどう防ぐかの約束に変える。

## 出力形式(`analysis.json`)

```json
{
  "controllers": [{ "id": "carController", "implemented": true }, { "id": "passenger", "implemented": false }],
  "losses": [{ "id": "L-1", "text": "..." }],
  "hazards": [{ "id": "H-1", "text": "...", "losses": ["L-1"] }],
  "controlActions": [
    { "id": "CA-1", "controller": "carController", "name": "move" },
    { "id": "CA-2", "controller": "passenger", "name": "call", "event": "hall.call" }
  ],
  "ucas": [{ "id": "UCA-1", "action": "CA-1", "type": "providedUnsafe", "context": "...", "hazards": ["H-1"] }],
  "notApplicable": [{ "action": "CA-1", "type": "notProvided", "reason": "..." }],
  "constraints": [{ "id": "SC-1", "text": "...", "ucas": ["UCA-1"], "refs": ["input.door.obstructed", "output.car.motion"] }]
}
```
