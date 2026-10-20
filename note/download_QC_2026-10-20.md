lancelet下载 QC 结果整体很好：95 条全部到位，没有缺失、多余或重复。两个需要处理的问题：

1. 5 条“物种不匹配”是表格标签问题，不是序列错误。  
XP_0356... 这组 accession 在 NCBI 上属于 **Branchiostoma floridae**（佛罗里达文昌鱼），不是表里写的 “Branchiostoma lancelet”。序列本身可用，建议后续元数据改成 `Branchiostoma floridae`，避免建树和写报告时混淆。

2. 真正需要检查的是 Mnemiopsis leidyi 的 CDK9：832 aa，人源是 372 aa，长度比 2.24。  
这可能是：长 C 端延伸、基因融合/错误注释，或者抓到了旁系同源蛋白。先确认它的结构域组成，再决定保留、截取还是替换。
- Mnemiopsis leidyi 的 KAL5253019.1 注释是 “hypothetical protein ACHWQZ_G015693”，有可能不一定是 CDK9，需要确认。它可能是错误 accession、基因融合，或者只是基因组预测里的一个含激酶域蛋白。这个需要重点处理，必要时替换成该物种真正的 CDK9 同源序列。
- Monodelphis 的 CDK9 是 508 aa，也偏长，但 header 明确写的是 CDK9，先用结构域扫描确认。