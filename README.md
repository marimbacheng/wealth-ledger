# 跨券商總報酬帳

把 Schwab 六年的投資紀錄，和之後在台灣複委託重新買進的部位接成一本帳。

- **券商帳**：各券商帳上的實際成本，用來和券商 App 對帳、計算海外所得。
- **延續帳**：把 Schwab 原始成本延續到複委託的新部位，用來看長期報酬與成本殖利率（YOC）。
- **總報酬**：延續帳未實現 + 已實現 + 股利淨額，跨券商合計。
- **股利**：每年稅前／預扣稅／稅後、個股累積、複委託今年實領、未來 12 個月預估、股利再投入增加的股數。
- **圖表**：持股比例與產業分布（漸層環圈圖）、資產成長、每年股利。

## 資料放在哪裡

**只在你自己的瀏覽器裡（localStorage）**。網站本身只有程式，不含任何財務資料，部署到 GitHub Pages 也一樣。

- 換電腦或換瀏覽器：在「匯入與設定 → 備份與還原」下載備份 JSON，到新的地方還原。
- 備份檔與 Schwab 匯出檔都已列入 `.gitignore`，不要手動加進 repo。

## 手機、電腦同步（選用）

資料在瀏覽器裡用你的密語加密後，存到你自己的**私人** GitHub repo；GitHub 上只看得到亂碼。

1. 建一個私人 repo（例如 `wealth-ledger-data`）。
2. GitHub → Settings → Developer settings → Fine-grained tokens → 新增 token：只選這個 repo，Repository permissions 的 Contents 設為 Read and write，到期日一年。
3. 每台裝置打開網站 →「匯入與設定 → 裝置同步」，填入帳號、repo、token，輸入同一組密語。
4. 之後打開網站會自動載入最新資料，修改後幾秒內自動上傳；每次同步都會在私人 repo 留下一個 commit，改錯可以回復。

注意：所有裝置要用同一個密語；密語不會上傳，忘記就解不開雲端資料。github.io 網址不支援同步（和其他 GitHub Pages 網站共用網域）。

## 使用方式

1. 從 Schwab 匯出：Positions、Transactions（日期拉到最早）、Investment Income、Realized Gain/Loss（日期拉到最早）、Balances。
2. 開啟網站 →「匯入與設定」→ 把 CSV 全部拖進去。
3. **在 Schwab 賣出前**，確認已匯入最新一份 Positions（延續帳的起點）。
4. 賣出、匯款後，再匯出一次 Schwab 交易紀錄與已實現損益並匯入。
5. 複委託（永豐大戶投）的買進、股利：在「交易帳」手動新增，或下載範本整理成 CSV 匯入。舊對帳單的月底總值可用「月底總值範本」整批匯入。從 Schwab 匯回的錢記成「轉入」，中轉行手續費記成「費用」。
6. 在「匯入與設定」確認遷移區間，檢查配對表。

## 開發

```bash
npm install
npm run dev
npm test
```

`tests/import.real.test.ts` 會讀本機的 `20261015 Schwab 資料/`，資料夾不存在時自動略過。

## 部署到 Cloudflare Pages（建議）

1. 登入 Cloudflare → Workers & Pages → Create → Pages → Connect to Git，授權 GitHub 時只選這個 repo。
2. Build command：`npm run build`；Build output directory：`dist`；其餘預設。
3. 之後每次推上 `main` 會自動部署到 `https://<專案名稱>.pages.dev/`。安全標頭在 `public/_headers`。

## 部署到 GitHub Pages（舊）

1. 在 GitHub 建立 repo，推上 `main`。
2. repo 的 Settings → Pages → Source 選 **GitHub Actions**。
3. 之後每次推上 `main`，`.github/workflows/deploy.yml` 會跑測試、建置並部署到 `https://<帳號>.github.io/<repo 名稱>/`。

決策與理由見 [NOTES.md](NOTES.md)。
